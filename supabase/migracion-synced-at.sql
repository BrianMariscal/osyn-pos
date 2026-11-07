-- OSYN POS: marca de sincronización puesta por el servidor.
-- Ejecutar en Supabase SQL Editor (se puede correr más de una vez).
--
-- updated_at lo pone el dispositivo que edita, con su reloj y al momento de
-- editar (no al subir). Si otro dispositivo lee la nube entre la edición y la
-- subida, o los relojes no coinciden, esa fila queda fuera de su lectura
-- incremental para siempre. synced_at lo pone Postgres en cada insert/update,
-- así la app lee "todo lo que llegó al servidor desde la última vez".

create or replace function public.set_synced_at()
returns trigger
language plpgsql
as $$
begin
  new.synced_at := clock_timestamp();
  return new;
end;
$$;

do $$
declare
  t text;
begin
  foreach t in array array[
    'branches', 'suppliers', 'products', 'product_stocks', 'customers', 'sales', 'returns',
    'expenses', 'purchases', 'mermas', 'shifts', 'month_closings', 'inventory_counts'
  ]
  loop
    if exists (select 1 from information_schema.tables where table_schema = 'public' and table_name = t) then
      execute format('alter table public.%I add column if not exists synced_at timestamptz not null default clock_timestamp()', t);
      execute format('create index if not exists %I on public.%I (synced_at)', 'idx_' || t || '_synced', t);
      execute format('drop trigger if exists trg_%s_synced_at on public.%I', t, t);
      execute format(
        'create trigger trg_%s_synced_at before insert or update on public.%I for each row execute function public.set_synced_at()',
        t, t
      );
    end if;
  end loop;
end $$;

-- Recarga el esquema de PostgREST para que la columna nueva sea visible ya.
notify pgrst, 'reload schema';

-- Verificación: deben salir 13 filas (returns aparece tras migracion-devoluciones.sql).
select distinct event_object_table as tabla, trigger_name
from information_schema.triggers
where trigger_name like 'trg_%_synced_at'
order by 1;
