-- Abarrotes POS: el servidor protege el saldo de fiado.
-- Ejecutar en Supabase SQL Editor DESPUÉS de supabase-migracion-stock-servidor.sql
-- (usa public.pos_is_manager_or_service). Se puede correr más de una vez.
--
-- Antes un vendedor podía subir cualquier saldo para un cliente (p. ej. dejarlo
-- en 0) con solo editar la fila. Ahora, para vendedores:
--   * El historial de movimientos solo crece: nunca se borra un cargo o pago.
--   * El saldo NO se toma del dispositivo: es el saldo anterior más los cargos
--     y menos los pagos NUEVOS (nunca baja de 0).
-- Dueño y administrador siguen pudiendo corregir saldos a mano.
-- De paso, si dos dispositivos registran movimientos a la vez, ya no se pierde
-- ninguno: se unen los dos historiales.

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

  -- Movimientos nuevos = los que llegan y no estaban (por id).
  select coalesce(sum(case m->>'type'
                        when 'cargo' then greatest(coalesce((m->>'amount')::numeric, 0), 0)
                        when 'pago' then -greatest(coalesce((m->>'amount')::numeric, 0), 0)
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

-- Verificación: debe salir trg_customers_guard.
select trigger_name from information_schema.triggers where trigger_name = 'trg_customers_guard';
