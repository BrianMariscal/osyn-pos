-- Abarrotes POS: endurecimiento de permisos e integridad basica.
-- Ejecutar en Supabase SQL Editor despues de supabase/schema.sql.

-- Los vendedores pueden consultar proveedores, pero solo dueño/admin los
-- administran. Las compras siguen siendo por sucursal.
drop policy if exists "suppliers_insert" on suppliers;
drop policy if exists "suppliers_update" on suppliers;
drop policy if exists "suppliers_delete" on suppliers;
create policy "suppliers_manager_insert" on suppliers for insert to authenticated
  with check (public.is_manager());
create policy "suppliers_manager_update" on suppliers for update to authenticated
  using (public.is_manager())
  with check (public.is_manager());
create policy "suppliers_owner_delete" on suppliers for delete to authenticated
  using (public.current_user_role() = 'dueno');

-- Evita cantidades y montos imposibles aunque se escriba directamente por
-- PostgREST. Las operaciones atomicas de stock/saldo deben implementarse con
-- RPC antes de permitir escrituras financieras no confiables desde clientes.
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'products_nonnegative_values') then
    alter table products add constraint products_nonnegative_values
      check (cost >= 0 and price >= 0 and stock >= 0 and min_stock >= 0);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'product_stocks_nonnegative_values') then
    alter table product_stocks add constraint product_stocks_nonnegative_values
      check (stock >= 0 and min_stock >= 0);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'purchases_valid_values') then
    alter table purchases add constraint purchases_valid_values
      check (qty > 0 and total >= 0);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'expenses_valid_amount') then
    alter table expenses add constraint expenses_valid_amount
      check (amount >= 0);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'customers_valid_balance') then
    alter table customers add constraint customers_valid_balance
      check (balance >= 0);
  end if;
end $$;

-- Rechaza NaN e infinitos que algunos clientes pueden enviar como numeric.
alter table products drop constraint if exists products_finite_values;
alter table products add constraint products_finite_values
  check (cost <> 'NaN'::numeric and price <> 'NaN'::numeric and stock <> 'NaN'::numeric and min_stock <> 'NaN'::numeric);
alter table purchases drop constraint if exists purchases_finite_values;
alter table purchases add constraint purchases_finite_values
  check (qty <> 'NaN'::numeric and total <> 'NaN'::numeric);
alter table expenses drop constraint if exists expenses_finite_amount;
alter table expenses add constraint expenses_finite_amount
  check (amount <> 'NaN'::numeric);
