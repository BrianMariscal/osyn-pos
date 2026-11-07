-- OSYN POS: devoluciones de mercancía (tabla returns) validadas por el servidor.
-- Ejecutar en Supabase SQL Editor DESPUÉS de supabase/migracion-stock-servidor.sql
-- y de supabase/migracion-guardias-fiado.sql (esta migración reemplaza
-- pos_guard_customer para que las devoluciones abonen al fiado). Se puede correr
-- más de una vez.
--
-- Qué agrega:
--   * Tabla returns con RLS por sucursal, synced_at y tiempo real: se
--     sincroniza igual que las ventas.
--   * Cada devolución regresa sus piezas al stock; si gerencia la borra, las
--     vuelve a descontar.
--   * El precio y el costo de lo devuelto se toman SIEMPRE de la venta original
--     (el dispositivo no los decide) y la cantidad nunca pasa de lo vendido
--     menos lo ya devuelto en ese renglón.
--   * Los vendedores SÍ registran devoluciones, pero no las modifican después.
--   * Las ventas de uso interno no se pueden devolver.

-- Requisito: esta migración reutiliza y reemplaza funciones de la migración de
-- stock del servidor. Si falta, avisa aquí en lugar de fallar a medias.
do $$
begin
  if to_regprocedure('public.pos_is_manager_or_service()') is null
     or to_regprocedure('public.pos_adjust_stock(text,text,numeric)') is null
     or to_regprocedure('public.pos_sale_pieces(jsonb)') is null then
    raise exception 'Aplica supabase/migracion-stock-servidor.sql antes de migracion-devoluciones.sql';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Tabla, RLS, índices y sincronización
-- ---------------------------------------------------------------------------

create table if not exists public.returns (
  id text primary key,
  branch_id text references public.branches(id),
  sale_id text,
  folio text default '',
  items jsonb default '[]'::jsonb,
  total numeric default 0,
  cost numeric default 0,
  payment text,
  customer_id text,
  reason text default '',
  note text default '',
  cashier text default '',
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  deleted boolean default false,
  data jsonb
);

alter table public.returns enable row level security;

drop policy if exists "txn_returns_select" on public.returns;
drop policy if exists "txn_returns_insert" on public.returns;
drop policy if exists "txn_returns_update" on public.returns;
drop policy if exists "txn_returns_delete" on public.returns;
create policy "txn_returns_select" on public.returns for select to authenticated
  using (public.is_manager() or branch_id = public.current_user_branch());
create policy "txn_returns_insert" on public.returns for insert to authenticated
  with check (public.is_manager() or branch_id = public.current_user_branch());
create policy "txn_returns_update" on public.returns for update to authenticated
  using (public.is_manager() or branch_id = public.current_user_branch())
  with check (public.is_manager() or branch_id = public.current_user_branch());
create policy "txn_returns_delete" on public.returns for delete to authenticated
  using (public.current_user_role() = 'dueno');

-- Por si la base todavía no tiene migracion-synced-at.sql:
create or replace function public.set_synced_at()
returns trigger
language plpgsql
as $$
begin
  new.synced_at := clock_timestamp();
  return new;
end;
$$;

-- synced_at: el reloj del servidor para la lectura incremental.
alter table public.returns add column if not exists synced_at timestamptz not null default clock_timestamp();

create index if not exists idx_returns_updated on public.returns (updated_at);
create index if not exists idx_returns_branch_created on public.returns (branch_id, created_at);
create index if not exists idx_returns_sale on public.returns (sale_id);
create index if not exists idx_returns_synced on public.returns (synced_at);

drop trigger if exists trg_returns_synced_at on public.returns;
create trigger trg_returns_synced_at
  before insert or update on public.returns
  for each row execute function public.set_synced_at();

-- Tiempo real: la app recibe el aviso y lanza su sync normal.
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (
       select 1 from pg_publication_tables
       where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'returns'
     ) then
    alter publication supabase_realtime add table public.returns;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Guardia: valida y recalcula cada devolución contra su venta original
-- ---------------------------------------------------------------------------

create or replace function public.pos_guard_return()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sale record;
  v_item jsonb;
  v_orig jsonb;
  v_items jsonb := '[]'::jsonb;
  v_index int;
  v_qty numeric;
  v_sold numeric;
  v_returned numeric;
  v_total numeric := 0;
  v_cost numeric := 0;
begin
  if tg_op = 'UPDATE' then
    -- Un vendedor no modifica una devolución ya registrada.
    if not public.pos_is_manager_or_service() then
      return null;
    end if;
    -- Quién lleva el stock se decidió al insertar y no cambia.
    new.data := coalesce(new.data, '{}'::jsonb)
      || jsonb_build_object('stock_by_server', coalesce((old.data->>'stock_by_server')::boolean, false));
    -- Borrado por gerencia: solo revierte el stock; no se valida otra vez.
    if coalesce(new.deleted, false) then
      return new;
    end if;
  elsif not public.pos_is_manager_or_service() then
    -- La app nueva marca sus devoluciones; para vendedores el stock lo lleva el servidor.
    new.data := coalesce(new.data, '{}'::jsonb) || '{"stock_by_server": true}'::jsonb;
  end if;

  -- Se bloquea la fila de la venta: dos devoluciones a la vez no pueden pasar del tope.
  select id, branch_id, payment, customer_id, items
    into v_sale
  from public.sales
  where id = new.sale_id
  for update;
  if not found then
    raise exception 'La devolución % no tiene venta original', new.id using errcode = '23514';
  end if;
  if v_sale.payment = 'interno' then
    raise exception 'La venta % es de uso interno y no se puede devolver', new.id using errcode = '23514';
  end if;
  if v_sale.branch_id is not null and new.branch_id is distinct from v_sale.branch_id then
    raise exception 'La devolución % no es de la sucursal de la venta', new.id using errcode = '23514';
  end if;
  if coalesce(new.payment, '') not in ('efectivo', 'transferencia', 'tarjeta', 'fiado') then
    raise exception 'La devolución % trae una forma de reembolso inválida', new.id using errcode = '23514';
  end if;
  if new.payment = 'fiado' and new.customer_id is distinct from v_sale.customer_id then
    raise exception 'La devolución % no puede abonar a fiado: la venta no es de ese cliente', new.id using errcode = '23514';
  end if;
  if jsonb_typeof(new.items) is distinct from 'array' or jsonb_array_length(new.items) = 0 then
    raise exception 'La devolución % no trae renglones válidos', new.id using errcode = '23514';
  end if;
  -- Renglones repetidos del mismo índice burlarían el tope (cada uno se
  -- validaría por separado): se rechazan de plano.
  if exists (
    select 1
    from jsonb_array_elements(new.items) as item
    group by item->>'index'
    having count(*) > 1
  ) then
    raise exception 'La devolución % repite un renglón de la venta', new.id using errcode = '23514';
  end if;

  for v_item in select value from jsonb_array_elements(new.items) loop
    v_index := coalesce((v_item->>'index')::int, -1);
    v_orig := v_sale.items -> v_index;
    if v_orig is null then
      raise exception 'La devolución % trae un renglón que no existe en la venta', new.id using errcode = '23514';
    end if;
    v_qty := coalesce((v_item->>'qty')::numeric, 0);
    if v_qty <= 0 then
      raise exception 'La devolución % trae una cantidad inválida', new.id using errcode = '23514';
    end if;
    v_sold := coalesce((v_orig->>'qty')::numeric, 0);
    select coalesce(sum(coalesce((r_item->>'qty')::numeric, 0)), 0)
      into v_returned
    from public.returns r
    cross join lateral jsonb_array_elements(
      case when jsonb_typeof(r.items) = 'array' then r.items else '[]'::jsonb end
    ) as r_item
    where r.sale_id = new.sale_id
      and r.id <> new.id
      and not coalesce(r.deleted, false)
      and coalesce((r_item->>'index')::int, -1) = v_index;
    if v_qty > v_sold - v_returned + 0.0001 then
      raise exception 'La devolución % pasa de lo vendido en el renglón %', new.id, v_index using errcode = '23514';
    end if;
    -- Precio y costo SIEMPRE de la venta original (el dispositivo no los decide).
    v_total := v_total + round(v_qty * round(coalesce((v_orig->>'price')::numeric, 0) * 100));
    v_cost := v_cost + round(v_qty * round(coalesce((v_orig->>'cost')::numeric, 0) * 100));
    v_items := v_items || jsonb_build_array(v_orig || jsonb_build_object('index', v_index, 'qty', v_qty));
  end loop;

  new.items := v_items;
  new.total := round(v_total / 100, 2);
  new.cost := round(v_cost / 100, 2);
  return new;
end;
$$;

drop trigger if exists trg_returns_guard on public.returns;
create trigger trg_returns_guard
  before insert or update on public.returns
  for each row execute function public.pos_guard_return();

-- ---------------------------------------------------------------------------
-- Efecto en stock: se reemplaza pos_movement_stock para que las devoluciones
-- regresen piezas (signo +). Ventas y mermas siguen restando; compras suman.
-- ---------------------------------------------------------------------------

create or replace function public.pos_movement_stock()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  r record;
  v_sign numeric := case tg_table_name when 'purchases' then 1 when 'returns' then 1 else -1 end;
begin
  -- Revierte el efecto anterior (edición o borrado por gerencia)...
  if tg_op in ('UPDATE', 'DELETE')
     and not coalesce(old.deleted, false)
     and coalesce((old.data->>'stock_by_server')::boolean, false) then
    if tg_table_name in ('sales', 'returns') then
      for r in select * from public.pos_sale_pieces(old.items) loop
        perform public.pos_adjust_stock(r.product_id, old.branch_id, -v_sign * r.pieces);
      end loop;
    else
      perform public.pos_adjust_stock(old.product_id, old.branch_id, -v_sign * coalesce(old.qty, 0));
    end if;
  end if;
  -- ...y aplica el nuevo.
  if tg_op in ('INSERT', 'UPDATE')
     and not coalesce(new.deleted, false)
     and coalesce((new.data->>'stock_by_server')::boolean, false) then
    if tg_table_name in ('sales', 'returns') then
      for r in select * from public.pos_sale_pieces(new.items) loop
        perform public.pos_adjust_stock(r.product_id, new.branch_id, v_sign * r.pieces);
      end loop;
    else
      perform public.pos_adjust_stock(new.product_id, new.branch_id, v_sign * coalesce(new.qty, 0));
    end if;
  end if;
  return null;
end;
$$;

drop trigger if exists trg_returns_stock on public.returns;
create trigger trg_returns_stock
  after insert or update or delete on public.returns
  for each row execute function public.pos_movement_stock();

-- ---------------------------------------------------------------------------
-- Fiado: los movimientos "devolucion" abonan al saldo (como un pago)
-- ---------------------------------------------------------------------------

create or replace function public.pos_guard_customer()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_old_movements jsonb := '[]'::jsonb;
  v_old_balance numeric := 0;
  v_delta numeric := 0;
begin
  if public.pos_is_manager_or_service() then
    return new;
  end if;

  if tg_op = 'UPDATE' then
    v_old_movements := case when jsonb_typeof(old.movements) = 'array' then old.movements else '[]'::jsonb end;
    v_old_balance := coalesce(old.balance, 0);
  end if;

  -- Un movimiento "devolucion" NUEVO solo vale si existe su devolución
  -- registrada, del mismo cliente y por el mismo importe. Los movimientos
  -- viejos ya aceptados no se revisan (no se castiga el pasado). La app sube
  -- returns antes que customers, así que el cliente honesto pasa en un ciclo.
  if exists (
    select 1
    from jsonb_array_elements(case when jsonb_typeof(new.movements) = 'array' then new.movements else '[]'::jsonb end) as m
    where m->>'type' = 'devolucion'
      and not exists (
        select 1
        from jsonb_array_elements(case when jsonb_typeof(old.movements) = 'array' then old.movements else '[]'::jsonb end) as o
        where o->>'id' = m->>'id'
      )
      and not exists (
        select 1 from public.returns r
        where r.id = coalesce(m->>'return_id', '')
          and r.customer_id = new.id
          and not coalesce(r.deleted, false)
          and abs(r.total - coalesce((m->>'amount')::numeric, -1)) < 0.005
      )
  ) then
    raise exception 'Movimiento de devolución sin devolución registrada' using errcode = '23514';
  end if;
  -- Una devolución solo se abona una vez: si hay dos movimientos con el mismo
  -- return_id y al menos uno es nuevo, el segundo sería un abono duplicado.
  if exists (
    select 1
    from (
      select m->>'return_id' as rid,
             count(*) as total,
             bool_or(
               not exists (
                 select 1
                 from jsonb_array_elements(case when jsonb_typeof(old.movements) = 'array' then old.movements else '[]'::jsonb end) as o
                 where o->>'id' = m->>'id'
               )
             ) as has_new
      from jsonb_array_elements(case when jsonb_typeof(new.movements) = 'array' then new.movements else '[]'::jsonb end) as m
      where m->>'type' = 'devolucion'
      group by 1
    ) d
    where d.total > 1 and d.has_new
  ) then
    raise exception 'La devolución ya se abonó a este cliente' using errcode = '23514';
  end if;

  -- Movimientos nuevos = los que llegan y no estaban (por id).
  -- Las devoluciones abonan igual que un pago.
  select coalesce(sum(case m->>'type'
                        when 'cargo' then greatest(coalesce((m->>'amount')::numeric, 0), 0)
                        when 'pago' then -greatest(coalesce((m->>'amount')::numeric, 0), 0)
                        when 'devolucion' then -greatest(coalesce((m->>'amount')::numeric, 0), 0)
                        else 0 end), 0)
    into v_delta
  from jsonb_array_elements(case when jsonb_typeof(new.movements) = 'array' then new.movements else '[]'::jsonb end) as m
  where not exists (
    select 1 from jsonb_array_elements(v_old_movements) as o where o->>'id' = m->>'id'
  );

  -- Historial = anteriores ∪ nuevos, del más reciente al más antiguo.
  select coalesce(jsonb_agg(mv order by mv->>'created_at' desc), '[]'::jsonb)
    into new.movements
  from (
    select o as mv from jsonb_array_elements(v_old_movements) as o
    union all
    select m from jsonb_array_elements(case when jsonb_typeof(new.movements) = 'array' then new.movements else '[]'::jsonb end) as m
    where not exists (
      select 1 from jsonb_array_elements(v_old_movements) as o where o->>'id' = m->>'id'
    )
  ) as merged;

  new.balance := greatest(round(v_old_balance + v_delta, 2), 0);
  return new;
end;
$$;

drop trigger if exists trg_customers_guard on public.customers;
create trigger trg_customers_guard
  before insert or update on public.customers
  for each row execute function public.pos_guard_customer();

notify pgrst, 'reload schema';

-- Verificación: deben salir trg_returns_guard, trg_returns_stock y trg_returns_synced_at.
select trigger_name
from information_schema.triggers
where event_object_table = 'returns'
order by trigger_name;
