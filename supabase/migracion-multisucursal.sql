-- ============================================================================
-- Abarrotes POS — MIGRACIÓN MULTI-SUCURSAL para bases YA EXISTENTES
-- Preserva TODOS los datos: productos, clientes, ventas, gastos, cortes, etc.
--
-- Ejecutar en Supabase > SQL Editor. Es idempotente (se puede re-ejecutar).
--
-- Qué hace:
--   1. Crea la tabla branches con Sucursal 1 y Sucursal 2.
--   2. Crea product_stocks y copia el stock actual de products a Sucursal 1
--      (Sucursal 2 arranca en 0; se ajusta desde Inventario).
--   3. Agrega branch_id a ventas, gastos, compras, cortes, fiado y conteos,
--      y asigna los registros existentes a Sucursal 1.
--   4. Agrega columnas deleted (borrado lógico) y created_at faltantes.
--   5. Agrega branch_id a profiles y asigna los empleados a Sucursal 1.
--   6. Reemplaza las políticas RLS por las de roles + sucursal.
--   7. Crea índices para la sincronización incremental.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Sucursales
-- ---------------------------------------------------------------------------

create table if not exists branches (
  id text primary key,
  name text not null,
  address text default '',
  active boolean default true,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  deleted boolean default false,
  data jsonb
);

insert into branches (id, name) values
  ('sucursal-1', 'Sucursal 1'),
  ('sucursal-2', 'Sucursal 2')
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- 2. Columnas nuevas en tablas existentes (sin perder nada)
-- ---------------------------------------------------------------------------

alter table products add column if not exists created_at timestamptz default now();
alter table products add column if not exists deleted boolean default false;
update products set created_at = coalesce(created_at, updated_at, now()) where created_at is null;

alter table customers add column if not exists branch_id text;
alter table customers add column if not exists deleted boolean default false;

alter table sales add column if not exists branch_id text;
alter table sales add column if not exists deleted boolean default false;

alter table expenses add column if not exists branch_id text;
alter table expenses add column if not exists deleted boolean default false;

alter table purchases add column if not exists branch_id text;
alter table purchases add column if not exists deleted boolean default false;
alter table purchases add column if not exists um text;

alter table shifts add column if not exists branch_id text;
alter table shifts add column if not exists deleted boolean default false;

alter table month_closings add column if not exists branch_id text;
alter table month_closings add column if not exists deleted boolean default false;

alter table inventory_counts add column if not exists branch_id text;
alter table inventory_counts add column if not exists deleted boolean default false;

alter table profiles add column if not exists branch_id text;

-- proveedores y mermas (nuevos)
create table if not exists suppliers (
  id text primary key,
  name text not null,
  phone text default '',
  notes text default '',
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  deleted boolean default false,
  data jsonb
);

create table if not exists mermas (
  id text primary key,
  branch_id text references branches(id),
  product_id text,
  product_name text,
  um text,
  qty numeric default 0,
  reason text,
  note text default '',
  cost_impact numeric default 0,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  deleted boolean default false,
  data jsonb
);

alter table suppliers enable row level security;
alter table mermas enable row level security;

-- productos: ver políticas "products_*" más abajo (lectura de ajustes a todos,
-- edición/borrado y ajustes solo admin).

-- proveedores: catálogo global administrable por admin y empleados
drop policy if exists "suppliers_select" on suppliers;
drop policy if exists "suppliers_insert" on suppliers;
drop policy if exists "suppliers_update" on suppliers;
drop policy if exists "suppliers_delete" on suppliers;
create policy "suppliers_select" on suppliers for select to authenticated
  using (true);
create policy "suppliers_insert" on suppliers for insert to authenticated
  with check (true);
create policy "suppliers_update" on suppliers for update to authenticated
  using (true)
  with check (true);
create policy "suppliers_delete" on suppliers for delete to authenticated
  using (public.current_user_role() = 'admin');

-- mermas: por sucursal, como los gastos
drop policy if exists "txn_mermas_select" on mermas;
drop policy if exists "txn_mermas_insert" on mermas;
drop policy if exists "txn_mermas_update" on mermas;
drop policy if exists "txn_mermas_delete" on mermas;
create policy "txn_mermas_select" on mermas for select to authenticated
  using (public.current_user_role() = 'admin' or branch_id = public.current_user_branch());
create policy "txn_mermas_insert" on mermas for insert to authenticated
  with check (public.current_user_role() = 'admin' or branch_id = public.current_user_branch());
create policy "txn_mermas_update" on mermas for update to authenticated
  using (public.current_user_role() = 'admin' or branch_id = public.current_user_branch())
  with check (public.current_user_role() = 'admin' or branch_id = public.current_user_branch());
create policy "txn_mermas_delete" on mermas for delete to authenticated
  using (public.current_user_role() = 'admin');

create index if not exists idx_suppliers_updated on suppliers (updated_at);
create index if not exists idx_mermas_updated on mermas (updated_at);
create index if not exists idx_mermas_branch on mermas (branch_id);

-- Backfill: los datos históricos quedan en Sucursal 1
update customers        set branch_id = 'sucursal-1' where branch_id is null;
update sales            set branch_id = 'sucursal-1' where branch_id is null;
update expenses         set branch_id = 'sucursal-1' where branch_id is null;
update purchases        set branch_id = 'sucursal-1' where branch_id is null;
update shifts           set branch_id = 'sucursal-1' where branch_id is null;
update month_closings   set branch_id = 'sucursal-1' where branch_id is null;
update inventory_counts set branch_id = 'sucursal-1' where branch_id is null;
update profiles         set branch_id = 'sucursal-1' where role = 'empleado' and branch_id is null;

-- ---------------------------------------------------------------------------
-- 3. product_stocks: existencia por producto y sucursal
-- ---------------------------------------------------------------------------

create table if not exists product_stocks (
  id text primary key,
  product_id text not null references products(id) on delete cascade,
  branch_id text not null references branches(id),
  stock numeric default 0,
  min_stock numeric default 0,
  updated_at timestamptz default now(),
  deleted boolean default false,
  data jsonb
);

-- El stock actual de products pasa íntegro a Sucursal 1
insert into product_stocks (id, product_id, branch_id, stock, min_stock, updated_at)
select p.id || ':sucursal-1', p.id, 'sucursal-1', coalesce(p.stock, 0), coalesce(p.min_stock, 0), coalesce(p.updated_at, now())
from products p
where p.id <> '__pos_settings__'
on conflict (id) do nothing;

-- Sucursal 2 arranca con el mismo mínimo de aviso y stock en 0
insert into product_stocks (id, product_id, branch_id, stock, min_stock, updated_at)
select p.id || ':sucursal-2', p.id, 'sucursal-2', 0, coalesce(p.min_stock, 0), now()
from products p
where p.id <> '__pos_settings__'
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- 4. Funciones auxiliares
-- ---------------------------------------------------------------------------

create or replace function public.current_user_role()
returns text
language sql
security definer
set search_path = public
stable
as $$
  select role from public.profiles where user_id = auth.uid()
$$;

create or replace function public.current_user_branch()
returns text
language sql
security definer
set search_path = public
stable
as $$
  select branch_id from public.profiles where user_id = auth.uid()
$$;

create or replace function public.pos_settings()
returns jsonb
language sql
security definer
set search_path = public
stable
as $$
  select coalesce(data->'settings', '{}'::jsonb)
  from public.products
  where id = '__pos_settings__'
$$;

-- Sin este GRANT PostgREST no expone la función (403/404 en el RPC) y los
-- empleados/admins dejan de recibir nombre/logo/WhatsApp del dueño.
grant execute on function public.pos_settings() to authenticated;

-- ---------------------------------------------------------------------------
-- 5. RLS: reemplazo de políticas (roles + sucursal)
-- ---------------------------------------------------------------------------

alter table branches enable row level security;
alter table product_stocks enable row level security;
alter table products enable row level security;
alter table customers enable row level security;
alter table sales enable row level security;
alter table expenses enable row level security;
alter table purchases enable row level security;
alter table shifts enable row level security;
alter table month_closings enable row level security;
alter table inventory_counts enable row level security;
alter table profiles enable row level security;

-- profiles
drop policy if exists "profiles_select" on profiles;
drop policy if exists "profiles_admin_insert" on profiles;
drop policy if exists "profiles_admin_update" on profiles;
drop policy if exists "profiles_admin_delete" on profiles;
drop policy if exists "pos_profiles_all" on profiles;
create policy "profiles_select" on profiles for select to authenticated
  using (auth.uid() = user_id or public.current_user_role() = 'admin');
create policy "profiles_admin_insert" on profiles for insert to authenticated
  with check (public.current_user_role() = 'admin');
create policy "profiles_admin_update" on profiles for update to authenticated
  using (public.current_user_role() = 'admin')
  with check (public.current_user_role() = 'admin');
create policy "profiles_admin_delete" on profiles for delete to authenticated
  using (public.current_user_role() = 'admin');

-- branches
drop policy if exists "branches_select" on branches;
drop policy if exists "branches_admin_write" on branches;
create policy "branches_select" on branches for select to authenticated
  using (true);
create policy "branches_admin_write" on branches for all to authenticated
  using (public.current_user_role() = 'admin')
  with check (public.current_user_role() = 'admin');

-- products: lectura todos (la fila __pos_settings__ lleva nombre/logo/WhatsApp
-- a los vendedores; la app la aparta del catálogo). Escritura de catálogo:
-- admin/vendedor crean, editar/borrar y ajustes solo admin.
drop policy if exists "pos_products_all" on products;
drop policy if exists "products_select_by_role" on products;
drop policy if exists "products_insert_admin" on products;
drop policy if exists "products_update_admin_employee" on products;
drop policy if exists "products_delete_admin" on products;
drop policy if exists "products_select" on products;
drop policy if exists "products_insert" on products;
drop policy if exists "products_admin_insert" on products;
drop policy if exists "products_admin_update" on products;
drop policy if exists "products_admin_delete" on products;
create policy "products_select" on products for select to authenticated
  using (true);
create policy "products_insert" on products for insert to authenticated
  with check (
    public.current_user_role() = 'dueno'
    or (public.current_user_role() in ('admin', 'empleado') and id <> '__pos_settings__')
  );
create policy "products_admin_update" on products for update to authenticated
  using (
    public.current_user_role() = 'dueno'
    or (public.current_user_role() = 'admin' and id <> '__pos_settings__')
  )
  with check (
    public.current_user_role() = 'dueno'
    or (public.current_user_role() = 'admin' and id <> '__pos_settings__')
  );
create policy "products_admin_delete" on products for delete to authenticated
  using (public.current_user_role() = 'dueno');

-- product_stocks
drop policy if exists "stocks_select" on product_stocks;
drop policy if exists "stocks_insert" on product_stocks;
drop policy if exists "stocks_update" on product_stocks;
drop policy if exists "stocks_delete" on product_stocks;
create policy "stocks_select" on product_stocks for select to authenticated
  using (public.current_user_role() = 'admin' or branch_id = public.current_user_branch());
create policy "stocks_insert" on product_stocks for insert to authenticated
  with check (public.current_user_role() = 'admin' or branch_id = public.current_user_branch());
create policy "stocks_update" on product_stocks for update to authenticated
  using (public.current_user_role() = 'admin' or branch_id = public.current_user_branch())
  with check (public.current_user_role() = 'admin' or branch_id = public.current_user_branch());
create policy "stocks_delete" on product_stocks for delete to authenticated
  using (public.current_user_role() = 'admin');

-- Transaccionales: su sucursal lee/escribe; borrar solo admin
drop policy if exists "pos_customers_all" on customers;
drop policy if exists "customers_select_admin_employee" on customers;
drop policy if exists "customers_insert_admin_employee" on customers;
drop policy if exists "customers_update_admin_employee" on customers;
drop policy if exists "customers_delete_admin" on customers;
drop policy if exists "txn_customers_select" on customers;
drop policy if exists "txn_customers_insert" on customers;
drop policy if exists "txn_customers_update" on customers;
drop policy if exists "txn_customers_delete" on customers;
create policy "txn_customers_select" on customers for select to authenticated
  using (public.current_user_role() = 'admin' or branch_id = public.current_user_branch());
create policy "txn_customers_insert" on customers for insert to authenticated
  with check (public.current_user_role() = 'admin' or branch_id = public.current_user_branch());
create policy "txn_customers_update" on customers for update to authenticated
  using (public.current_user_role() = 'admin' or branch_id = public.current_user_branch())
  with check (public.current_user_role() = 'admin' or branch_id = public.current_user_branch());
create policy "txn_customers_delete" on customers for delete to authenticated
  using (public.current_user_role() = 'admin');

drop policy if exists "pos_sales_all" on sales;
drop policy if exists "sales_select_admin_employee" on sales;
drop policy if exists "sales_insert_admin_employee" on sales;
drop policy if exists "sales_update_admin_employee" on sales;
drop policy if exists "sales_delete_admin" on sales;
drop policy if exists "txn_sales_select" on sales;
drop policy if exists "txn_sales_insert" on sales;
drop policy if exists "txn_sales_update" on sales;
drop policy if exists "txn_sales_delete" on sales;
create policy "txn_sales_select" on sales for select to authenticated
  using (public.current_user_role() = 'admin' or branch_id = public.current_user_branch());
create policy "txn_sales_insert" on sales for insert to authenticated
  with check (public.current_user_role() = 'admin' or branch_id = public.current_user_branch());
create policy "txn_sales_update" on sales for update to authenticated
  using (public.current_user_role() = 'admin' or branch_id = public.current_user_branch())
  with check (public.current_user_role() = 'admin' or branch_id = public.current_user_branch());
create policy "txn_sales_delete" on sales for delete to authenticated
  using (public.current_user_role() = 'admin');

drop policy if exists "expenses_admin_all" on expenses;
drop policy if exists "txn_expenses_select" on expenses;
drop policy if exists "txn_expenses_insert" on expenses;
drop policy if exists "txn_expenses_update" on expenses;
drop policy if exists "txn_expenses_delete" on expenses;
create policy "txn_expenses_select" on expenses for select to authenticated
  using (public.current_user_role() = 'admin' or branch_id = public.current_user_branch());
create policy "txn_expenses_insert" on expenses for insert to authenticated
  with check (public.current_user_role() = 'admin' or branch_id = public.current_user_branch());
create policy "txn_expenses_update" on expenses for update to authenticated
  using (public.current_user_role() = 'admin' or branch_id = public.current_user_branch())
  with check (public.current_user_role() = 'admin' or branch_id = public.current_user_branch());
create policy "txn_expenses_delete" on expenses for delete to authenticated
  using (public.current_user_role() = 'admin');

drop policy if exists "purchases_admin_all" on purchases;
drop policy if exists "txn_purchases_select" on purchases;
drop policy if exists "txn_purchases_insert" on purchases;
drop policy if exists "txn_purchases_update" on purchases;
drop policy if exists "txn_purchases_delete" on purchases;
create policy "txn_purchases_select" on purchases for select to authenticated
  using (public.current_user_role() = 'admin' or branch_id = public.current_user_branch());
create policy "txn_purchases_insert" on purchases for insert to authenticated
  with check (public.current_user_role() = 'admin' or branch_id = public.current_user_branch());
create policy "txn_purchases_update" on purchases for update to authenticated
  using (public.current_user_role() = 'admin' or branch_id = public.current_user_branch())
  with check (public.current_user_role() = 'admin' or branch_id = public.current_user_branch());
create policy "txn_purchases_delete" on purchases for delete to authenticated
  using (public.current_user_role() = 'admin');

drop policy if exists "shifts_admin_all" on shifts;
drop policy if exists "txn_shifts_select" on shifts;
drop policy if exists "txn_shifts_insert" on shifts;
drop policy if exists "txn_shifts_update" on shifts;
drop policy if exists "txn_shifts_delete" on shifts;
create policy "txn_shifts_select" on shifts for select to authenticated
  using (public.current_user_role() = 'admin' or branch_id = public.current_user_branch());
create policy "txn_shifts_insert" on shifts for insert to authenticated
  with check (public.current_user_role() = 'admin' or branch_id = public.current_user_branch());
create policy "txn_shifts_update" on shifts for update to authenticated
  using (public.current_user_role() = 'admin' or branch_id = public.current_user_branch())
  with check (public.current_user_role() = 'admin' or branch_id = public.current_user_branch());
create policy "txn_shifts_delete" on shifts for delete to authenticated
  using (public.current_user_role() = 'admin');

drop policy if exists "inventory_counts_admin_all" on inventory_counts;
drop policy if exists "txn_counts_select" on inventory_counts;
drop policy if exists "txn_counts_insert" on inventory_counts;
drop policy if exists "txn_counts_update" on inventory_counts;
drop policy if exists "txn_counts_delete" on inventory_counts;
create policy "txn_counts_select" on inventory_counts for select to authenticated
  using (public.current_user_role() = 'admin' or branch_id = public.current_user_branch());
create policy "txn_counts_insert" on inventory_counts for insert to authenticated
  with check (public.current_user_role() = 'admin' or branch_id = public.current_user_branch());
create policy "txn_counts_update" on inventory_counts for update to authenticated
  using (public.current_user_role() = 'admin' or branch_id = public.current_user_branch())
  with check (public.current_user_role() = 'admin' or branch_id = public.current_user_branch());
create policy "txn_counts_delete" on inventory_counts for delete to authenticated
  using (public.current_user_role() = 'admin');

drop policy if exists "month_closings_admin_all" on month_closings;
drop policy if exists "closings_select" on month_closings;
drop policy if exists "closings_admin_write" on month_closings;
create policy "closings_select" on month_closings for select to authenticated
  using (public.current_user_role() = 'admin' or branch_id = public.current_user_branch());
create policy "closings_admin_write" on month_closings for all to authenticated
  using (public.current_user_role() = 'admin')
  with check (public.current_user_role() = 'admin');

-- ---------------------------------------------------------------------------
-- 6. Índices para sync incremental y reportes
-- ---------------------------------------------------------------------------

create index if not exists idx_branches_updated on branches (updated_at);
create index if not exists idx_products_updated on products (updated_at);
create index if not exists idx_stocks_updated on product_stocks (updated_at);
create index if not exists idx_stocks_product on product_stocks (product_id);
create index if not exists idx_stocks_branch on product_stocks (branch_id);
create index if not exists idx_customers_updated on customers (updated_at);
create index if not exists idx_customers_branch on customers (branch_id);
create index if not exists idx_sales_updated on sales (updated_at);
create index if not exists idx_sales_branch_created on sales (branch_id, created_at);
create index if not exists idx_expenses_updated on expenses (updated_at);
create index if not exists idx_expenses_branch on expenses (branch_id);
create index if not exists idx_purchases_updated on purchases (updated_at);
create index if not exists idx_purchases_branch on purchases (branch_id);
create index if not exists idx_shifts_updated on shifts (updated_at);
create index if not exists idx_shifts_branch on shifts (branch_id);
create index if not exists idx_closings_updated on month_closings (updated_at);
create index if not exists idx_counts_updated on inventory_counts (updated_at);
create index if not exists idx_counts_branch on inventory_counts (branch_id);

-- ---------------------------------------------------------------------------
-- 7. Verificación (opcional): los totales deben coincidir con los previos
-- ---------------------------------------------------------------------------
-- select (select count(*) from products where id <> '__pos_settings__') as productos,
--        (select count(*) from product_stocks where branch_id = 'sucursal-1') as stock_sucursal_1,
--        (select count(*) from sales) as ventas,
--        (select count(*) from customers) as clientes;
