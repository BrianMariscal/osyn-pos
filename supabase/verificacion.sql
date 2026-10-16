-- Abarrotes POS: ¿qué migraciones de seguridad tiene esta base?
-- Ejecutar en Supabase SQL Editor. Solo LEE, no cambia nada.
-- Cada renglón debe decir OK. Si alguno dice FALTA, aplica el archivo indicado.

select chequeo, case when ok then 'OK' else 'FALTA → ' || archivo end as estado
from (values
  ('RLS activo en las 14 tablas',
   (select count(*) = 14 from pg_tables
    where schemaname = 'public' and rowsecurity
      and tablename in ('branches','products','product_stocks','customers','sales','returns','expenses','purchases',
                        'suppliers','mermas','shifts','month_closings','inventory_counts','profiles')),
   'supabase/schema.sql'),
  ('Proveedores: solo gerencia los edita',
   exists (select 1 from pg_policies where schemaname = 'public' and policyname = 'suppliers_manager_update')
     and not exists (select 1 from pg_policies where schemaname = 'public' and policyname in ('suppliers_insert','suppliers_update')),
   'supabase/migracion-endurecimiento.sql'),
  ('Montos y existencias no negativos',
   exists (select 1 from pg_constraint where conname = 'product_stocks_nonnegative_values')
     and exists (select 1 from pg_constraint where conname = 'customers_valid_balance'),
   'supabase/migracion-endurecimiento.sql'),
  ('Cuentas sin perfil no leen catálogo',
   exists (select 1 from pg_policies where schemaname = 'public' and policyname = 'products_select' and qual like '%has_profile%'),
   'supabase/migracion-solo-perfiles.sql'),
  ('Stock lo lleva el servidor (7 triggers)',
   (select count(distinct trigger_name) = 7 from information_schema.triggers
    where trigger_name in ('trg_sales_guard','trg_sales_stock','trg_purchases_guard','trg_purchases_stock',
                           'trg_mermas_guard','trg_mermas_stock','trg_product_stocks_guard')),
   'supabase/migracion-stock-servidor.sql'),
  ('Saldo de fiado protegido',
   exists (select 1 from information_schema.triggers where trigger_name = 'trg_customers_guard'),
   'supabase/migracion-guardias-fiado.sql'),
  ('Devoluciones: tabla y validación en el servidor',
   (select count(distinct trigger_name) = 3 from information_schema.triggers
    where trigger_name in ('trg_returns_guard','trg_returns_stock','trg_returns_synced_at')),
   'supabase/migracion-devoluciones.sql'),
  ('Precios y cantidades validados por el servidor',
   exists (select 1 from information_schema.triggers where trigger_name = 'trg_sales_0_prices'),
   'supabase/migracion-precios-servidor.sql'),
  ('Marca synced_at del servidor',
   exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'sales' and column_name = 'synced_at'),
   'supabase/migracion-synced-at.sql'),
  ('Administrador por sucursal',
   exists (select 1 from pg_proc where proname = 'pos_all_branches'),
   'supabase/migracion-admin-sucursal.sql'),
  ('Tiempo real activado',
   exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'sales'),
   'supabase/migracion-realtime.sql')
) as t(chequeo, ok, archivo);
