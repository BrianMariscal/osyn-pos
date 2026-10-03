-- Abarrotes POS: sincronización en TIEMPO REAL entre dispositivos.
-- Ejecutar UNA vez en Supabase > SQL Editor (se puede repetir sin problema).
--
-- Agrega las tablas de la app a la publicación "supabase_realtime". La app solo
-- usa el aviso de cambio para lanzar su sync normal; las políticas RLS ya
-- existentes deciden qué cambios recibe cada usuario (su sucursal o, para
-- dueño/administrador, toda la tienda).

do $$
declare
  t text;
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    create publication supabase_realtime;
  end if;
  foreach t in array array[
    'branches', 'suppliers', 'products', 'product_stocks', 'customers', 'sales',
    'expenses', 'purchases', 'mermas', 'shifts', 'month_closings', 'inventory_counts'
  ]
  loop
    if exists (select 1 from information_schema.tables where table_schema = 'public' and table_name = t)
       and not exists (
         select 1 from pg_publication_tables
         where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t
       ) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;

-- Verificación: debe listar las 12 tablas.
select tablename from pg_publication_tables where pubname = 'supabase_realtime' order by tablename;
