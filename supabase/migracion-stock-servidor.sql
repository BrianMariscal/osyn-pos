-- Abarrotes POS: el servidor lleva el stock y valida ventas.
-- Ejecutar en Supabase SQL Editor (se puede correr más de una vez).
--
-- Antes cada dispositivo calculaba la existencia y la subía completa; un
-- vendedor podía escribir cualquier stock o editar ventas ya cobradas.
-- Ahora:
--   * Cada venta, compra y merma que llega mueve el stock en Postgres.
--   * Los vendedores no pueden cambiar existencias ni modificar movimientos ya
--     registrados (sus intentos se ignoran sin error, para no trabar la sync).
--   * El total, costo y ganancia de cada venta se recalculan con sus renglones.
--
-- Convivencia con versiones anteriores de la app: la app nueva marca sus
-- movimientos con data.stock_by_server = true y ya no sube el stock. La app
-- vieja de un vendedor sube el stock (se ignora) y la venta lo descuenta aquí;
-- la app vieja de dueño/admin sube el stock (se respeta) y su venta sin marca
-- no lo vuelve a descontar. Así no hay doble descuento en ninguna mezcla.

-- ---------------------------------------------------------------------------
-- Ajuste atómico de existencia (nunca baja de 0)
-- ---------------------------------------------------------------------------

create or replace function public.pos_adjust_stock(p_product text, p_branch text, p_delta numeric)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_product is null or p_branch is null or coalesce(p_delta, 0) = 0 then
    return;
  end if;
  if not exists (select 1 from public.products where id = p_product)
     or not exists (select 1 from public.branches where id = p_branch) then
    return;
  end if;
  perform set_config('pos.stock_server', '1', true);
  insert into public.product_stocks (id, product_id, branch_id, stock, min_stock, updated_at, deleted)
  values (p_product || ':' || p_branch, p_product, p_branch, greatest(p_delta, 0), 0, now(), false)
  on conflict (id) do update
    set stock = greatest(coalesce(product_stocks.stock, 0) + p_delta, 0),
        updated_at = now();
  perform set_config('pos.stock_server', '', true);
end;
$$;

revoke all on function public.pos_adjust_stock(text, text, numeric) from public, anon, authenticated;

-- Piezas por producto de los renglones de una venta (cajas × piezas por caja).
create or replace function public.pos_sale_pieces(p_items jsonb)
returns table (product_id text, pieces numeric)
language sql
immutable
as $$
  select item->>'productId',
         sum(coalesce((item->>'qty')::numeric, 0) * coalesce(nullif((item->>'pack_size')::numeric, 0), 1))
  from jsonb_array_elements(case when jsonb_typeof(p_items) = 'array' then p_items else '[]'::jsonb end) as item
  where item->>'productId' is not null
  group by 1
$$;

create or replace function public.pos_is_manager_or_service()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  -- Sin usuario (SQL Editor / service role) cuenta como gerencia.
  select auth.uid() is null or coalesce(public.is_manager(), false)
$$;

-- ---------------------------------------------------------------------------
-- Guardia de movimientos (ventas, compras, mermas)
-- ---------------------------------------------------------------------------

create or replace function public.pos_guard_movement()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_total numeric;
  v_cost numeric;
begin
  if tg_op = 'INSERT' then
    -- ¿El servidor lleva el stock de este movimiento? Siempre con la app nueva
    -- (marca) y siempre para vendedores (su stock subido se ignora).
    if coalesce((new.data->>'stock_by_server')::boolean, false) or not public.pos_is_manager_or_service() then
      new.data := coalesce(new.data, '{}'::jsonb) || '{"stock_by_server": true}'::jsonb;
    end if;
    if tg_table_name = 'sales' then
      select coalesce(sum(round(coalesce((item->>'qty')::numeric, 0) * round(coalesce((item->>'price')::numeric, 0) * 100))), 0),
             coalesce(sum(round(coalesce((item->>'qty')::numeric, 0) * round(coalesce((item->>'cost')::numeric, 0) * 100))), 0)
        into v_total, v_cost
      from jsonb_array_elements(case when jsonb_typeof(new.items) = 'array' then new.items else '[]'::jsonb end) as item;
      new.cost := round(v_cost / 100, 2);
      if new.payment = 'interno' then
        new.total := new.cost;
        new.profit := 0;
      else
        new.total := round(v_total / 100, 2);
        new.profit := round((v_total - v_cost) / 100, 2);
      end if;
    end if;
    return new;
  end if;

  -- UPDATE: un vendedor no modifica movimientos ya registrados.
  if not public.pos_is_manager_or_service() then
    return null;
  end if;
  -- La decisión de quién lleva el stock se toma al insertar y no cambia.
  new.data := coalesce(new.data, '{}'::jsonb)
    || jsonb_build_object('stock_by_server', coalesce((old.data->>'stock_by_server')::boolean, false));
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- Efecto en stock de cada movimiento
-- ---------------------------------------------------------------------------

create or replace function public.pos_movement_stock()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  r record;
  v_sign numeric := case tg_table_name when 'purchases' then 1 else -1 end;
begin
  -- Revierte el efecto anterior (edición o borrado por gerencia)...
  if tg_op in ('UPDATE', 'DELETE')
     and not coalesce(old.deleted, false)
     and coalesce((old.data->>'stock_by_server')::boolean, false) then
    if tg_table_name = 'sales' then
      for r in select * from public.pos_sale_pieces(old.items) loop
        perform public.pos_adjust_stock(r.product_id, old.branch_id, r.pieces);
      end loop;
    else
      perform public.pos_adjust_stock(old.product_id, old.branch_id, -v_sign * coalesce(old.qty, 0));
    end if;
  end if;
  -- ...y aplica el nuevo.
  if tg_op in ('INSERT', 'UPDATE')
     and not coalesce(new.deleted, false)
     and coalesce((new.data->>'stock_by_server')::boolean, false) then
    if tg_table_name = 'sales' then
      for r in select * from public.pos_sale_pieces(new.items) loop
        perform public.pos_adjust_stock(r.product_id, new.branch_id, -r.pieces);
      end loop;
    else
      perform public.pos_adjust_stock(new.product_id, new.branch_id, v_sign * coalesce(new.qty, 0));
    end if;
  end if;
  return null;
end;
$$;

do $$
declare
  t text;
begin
  foreach t in array array['sales', 'purchases', 'mermas'] loop
    execute format('drop trigger if exists trg_%s_guard on public.%I', t, t);
    execute format(
      'create trigger trg_%s_guard before insert or update on public.%I for each row execute function public.pos_guard_movement()',
      t, t
    );
    execute format('drop trigger if exists trg_%s_stock on public.%I', t, t);
    execute format(
      'create trigger trg_%s_stock after insert or update or delete on public.%I for each row execute function public.pos_movement_stock()',
      t, t
    );
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- Existencias: solo gerencia (o el propio servidor) cambia la cantidad
-- ---------------------------------------------------------------------------

create or replace function public.pos_guard_stock()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if current_setting('pos.stock_server', true) = '1' or public.pos_is_manager_or_service() then
    return new;
  end if;
  -- Vendedor: puede crear la fila (en 0) o tocar el mínimo; jamás la
  -- cantidad, el borrado, el producto ni la sucursal (si no, podría vaciar
  -- el inventario o esconder filas moviéndolas).
  if tg_op = 'INSERT' then
    new.stock := 0;
  else
    new.stock := old.stock;
    new.deleted := old.deleted;
    new.product_id := old.product_id;
    new.branch_id := old.branch_id;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_product_stocks_guard on public.product_stocks;
create trigger trg_product_stocks_guard
  before insert or update on public.product_stocks
  for each row execute function public.pos_guard_stock();

-- La app pregunta si el servidor ya lleva el stock.
create or replace function public.pos_server_stock()
returns boolean
language sql
stable
as $$ select true $$;

grant execute on function public.pos_server_stock() to authenticated;

notify pgrst, 'reload schema';

-- Verificación: deben salir 7 triggers.
select distinct event_object_table as tabla, trigger_name
from information_schema.triggers
where trigger_name in (
  'trg_sales_guard', 'trg_sales_stock', 'trg_purchases_guard', 'trg_purchases_stock',
  'trg_mermas_guard', 'trg_mermas_stock', 'trg_product_stocks_guard'
)
order by 1, 2;
