-- ============================================================================
-- Abarrotes POS — Schema completo MULTI-SUCURSAL (instalaciones nuevas)
-- Ejecutar en Supabase > SQL Editor.
-- Para una base YA EXISTENTE con datos, usa supabase/migracion-multisucursal.sql
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Tablas
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

create table if not exists products (
  id text primary key,
  name text,
  category text,
  cost numeric default 0,
  price numeric default 0,
  stock numeric default 0,          -- existencia heredada: se migra a product_stocks
  min_stock numeric default 0,      -- idem
  active boolean default true,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  deleted boolean default false,
  data jsonb
);

create table if not exists product_stocks (
  id text primary key,              -- product_id || ':' || branch_id
  product_id text not null references products(id) on delete cascade,
  branch_id text not null references branches(id),
  stock numeric default 0,
  min_stock numeric default 0,
  updated_at timestamptz default now(),
  deleted boolean default false,
  data jsonb
);

create table if not exists customers (
  id text primary key,
  branch_id text references branches(id),
  name text,
  phone text,
  balance numeric default 0,
  movements jsonb default '[]'::jsonb,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  deleted boolean default false,
  data jsonb
);

create table if not exists sales (
  id text primary key,
  branch_id text references branches(id),
  items jsonb default '[]'::jsonb,
  total numeric default 0,
  cost numeric default 0,
  profit numeric default 0,
  payment text,
  customer_id text,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  deleted boolean default false,
  data jsonb
);

create table if not exists returns (
  id text primary key,
  branch_id text references branches(id),
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

create table if not exists expenses (
  id text primary key,
  branch_id text references branches(id),
  concept text,
  amount numeric default 0,
  category text,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  deleted boolean default false,
  data jsonb
);

create table if not exists purchases (
  id text primary key,
  branch_id text references branches(id),
  supplier text,
  product_id text,
  product_name text,
  um text,
  qty numeric default 0,
  total numeric default 0,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  deleted boolean default false,
  data jsonb
);

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

create table if not exists shifts (
  id text primary key,
  branch_id text references branches(id),
  summary jsonb default '{}'::jsonb,
  opening_cash numeric default 0,
  counted_cash numeric default 0,
  withdrawn_cash numeric default 0,
  next_opening_cash numeric default 0,
  expected_cash_with_base numeric default 0,
  difference numeric default 0,
  distribution_difference numeric default 0,
  notes text,
  closed_at timestamptz default now(),
  updated_at timestamptz default now(),
  deleted boolean default false,
  data jsonb
);

create table if not exists month_closings (
  id text primary key,
  branch_id text references branches(id),
  month text,
  report jsonb default '{}'::jsonb,
  closed_at timestamptz default now(),
  updated_at timestamptz default now(),
  deleted boolean default false,
  data jsonb
);

create table if not exists inventory_counts (
  id text primary key,
  branch_id text references branches(id),
  started_at timestamptz,
  applied_at timestamptz default now(),
  summary jsonb default '{}'::jsonb,
  incidences jsonb default '[]'::jsonb,
  updated_at timestamptz default now(),
  deleted boolean default false,
  data jsonb
);

create table if not exists profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  name text,
  role text not null default 'empleado' check (role in ('dueno', 'admin', 'empleado')),
  branch_id text references branches(id),
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- ---------------------------------------------------------------------------
-- Sucursal inicial (una sola; el dueño agrega más desde la app)
-- ---------------------------------------------------------------------------

insert into branches (id, name) values
  ('sucursal-1', 'Sucursal 1')
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- Funciones auxiliares
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

-- Rol con acceso de gerencia (dueño o administrador): lee/opera toda la tienda.
-- El dueño además gestiona usuarios y sucursales; el administrador no.
create or replace function public.is_manager()
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select role in ('dueno', 'admin') from public.profiles where user_id = auth.uid()
$$;

-- ¿El usuario tiene perfil en la tienda? Una cuenta creada por el registro
-- abierto de Supabase Auth no lo tiene y no debe leer nada.
create or replace function public.has_profile()
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (select 1 from public.profiles where user_id = auth.uid())
$$;

grant execute on function public.has_profile() to authenticated;

-- Ajustes de la app legibles por cualquier usuario con perfil (solo lectura).
-- La escritura sigue siendo solo admin vía la fila products '__pos_settings__'.
create or replace function public.pos_settings()
returns jsonb
language sql
security definer
set search_path = public
stable
as $$
  select coalesce(data->'settings', '{}'::jsonb)
  from public.products
  where id = '__pos_settings__' and public.has_profile()
$$;

-- Sin este GRANT PostgREST no expone la función (403/404 en el RPC) y los
-- empleados/admins dejan de recibir nombre/logo/WhatsApp del dueño.
grant execute on function public.pos_settings() to authenticated;

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------

alter table branches enable row level security;
alter table products enable row level security;
alter table product_stocks enable row level security;
alter table customers enable row level security;
alter table sales enable row level security;
alter table returns enable row level security;
alter table expenses enable row level security;
alter table purchases enable row level security;
alter table suppliers enable row level security;
alter table mermas enable row level security;
alter table shifts enable row level security;
alter table month_closings enable row level security;
alter table inventory_counts enable row level security;
alter table profiles enable row level security;

-- profiles -------------------------------------------------------------------

drop policy if exists "profiles_select" on profiles;
drop policy if exists "profiles_admin_insert" on profiles;
drop policy if exists "profiles_owner_insert" on profiles;
drop policy if exists "profiles_admin_update" on profiles;
drop policy if exists "profiles_owner_update" on profiles;
drop policy if exists "profiles_admin_delete" on profiles;
drop policy if exists "profiles_owner_delete" on profiles;

create policy "profiles_select" on profiles for select to authenticated
  using (auth.uid() = user_id or public.is_manager());
create policy "profiles_owner_insert" on profiles for insert to authenticated
  with check (public.current_user_role() = 'dueno');
create policy "profiles_owner_update" on profiles for update to authenticated
  using (public.current_user_role() = 'dueno')
  with check (public.current_user_role() = 'dueno');
create policy "profiles_owner_delete" on profiles for delete to authenticated
  using (public.current_user_role() = 'dueno');

-- branches -------------------------------------------------------------------

drop policy if exists "branches_select" on branches;
drop policy if exists "branches_admin_write" on branches;
drop policy if exists "branches_owner_write" on branches;

create policy "branches_select" on branches for select to authenticated
  using (public.has_profile());
create policy "branches_owner_write" on branches for all to authenticated
  using (public.current_user_role() = 'dueno')
  with check (public.current_user_role() = 'dueno');

-- products (catálogo global: lectura todos; editar/borrar y ajustes solo admin) -

drop policy if exists "products_select" on products;
drop policy if exists "products_insert" on products;
drop policy if exists "products_admin_update" on products;
drop policy if exists "products_admin_delete" on products;

-- La lectura incluye la fila __pos_settings__ (nombre/logo/WhatsApp viajan ahí);
-- la app la aparta del catálogo y es la forma en que los vendedores reciben los
-- ajustes aunque la función pos_settings() aún no exista en la base.
create policy "products_select" on products for select to authenticated
  using (public.has_profile());
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

-- product_stocks (existencia por sucursal) ------------------------------------

drop policy if exists "stocks_select" on product_stocks;
drop policy if exists "stocks_insert" on product_stocks;
drop policy if exists "stocks_update" on product_stocks;
drop policy if exists "stocks_delete" on product_stocks;

create policy "stocks_select" on product_stocks for select to authenticated
  using (
    public.is_manager()
    or branch_id = public.current_user_branch()
  );
create policy "stocks_insert" on product_stocks for insert to authenticated
  with check (
    public.is_manager()
    or branch_id = public.current_user_branch()
  );
create policy "stocks_update" on product_stocks for update to authenticated
  using (
    public.is_manager()
    or branch_id = public.current_user_branch()
  )
  with check (
    public.is_manager()
    or branch_id = public.current_user_branch()
  );
create policy "stocks_delete" on product_stocks for delete to authenticated
  using (public.current_user_role() = 'dueno');

-- Tablas transaccionales: leer/escribir SU sucursal, borrar solo admin --------
-- (customers, sales, expenses, purchases, shifts, inventory_counts)

drop policy if exists "txn_customers_select" on customers;
drop policy if exists "txn_customers_insert" on customers;
drop policy if exists "txn_customers_update" on customers;
drop policy if exists "txn_customers_delete" on customers;
create policy "txn_customers_select" on customers for select to authenticated
  using (public.is_manager() or branch_id = public.current_user_branch());
create policy "txn_customers_insert" on customers for insert to authenticated
  with check (public.is_manager() or branch_id = public.current_user_branch());
create policy "txn_customers_update" on customers for update to authenticated
  using (public.is_manager() or branch_id = public.current_user_branch())
  with check (public.is_manager() or branch_id = public.current_user_branch());
create policy "txn_customers_delete" on customers for delete to authenticated
  using (public.current_user_role() = 'dueno');

drop policy if exists "txn_sales_select" on sales;
drop policy if exists "txn_sales_insert" on sales;
drop policy if exists "txn_sales_update" on sales;
drop policy if exists "txn_sales_delete" on sales;
create policy "txn_sales_select" on sales for select to authenticated
  using (public.is_manager() or branch_id = public.current_user_branch());
create policy "txn_sales_insert" on sales for insert to authenticated
  with check (public.is_manager() or branch_id = public.current_user_branch());
create policy "txn_sales_update" on sales for update to authenticated
  using (public.is_manager() or branch_id = public.current_user_branch())
  with check (public.is_manager() or branch_id = public.current_user_branch());
create policy "txn_sales_delete" on sales for delete to authenticated
  using (public.current_user_role() = 'dueno');

drop policy if exists "txn_returns_select" on returns;
drop policy if exists "txn_returns_insert" on returns;
drop policy if exists "txn_returns_update" on returns;
drop policy if exists "txn_returns_delete" on returns;
create policy "txn_returns_select" on returns for select to authenticated
  using (public.is_manager() or branch_id = public.current_user_branch());
create policy "txn_returns_insert" on returns for insert to authenticated
  with check (public.is_manager() or branch_id = public.current_user_branch());
create policy "txn_returns_update" on returns for update to authenticated
  using (public.is_manager() or branch_id = public.current_user_branch())
  with check (public.is_manager() or branch_id = public.current_user_branch());
create policy "txn_returns_delete" on returns for delete to authenticated
  using (public.current_user_role() = 'dueno');

drop policy if exists "txn_expenses_select" on expenses;
drop policy if exists "txn_expenses_insert" on expenses;
drop policy if exists "txn_expenses_update" on expenses;
drop policy if exists "txn_expenses_delete" on expenses;
create policy "txn_expenses_select" on expenses for select to authenticated
  using (public.is_manager() or branch_id = public.current_user_branch());
create policy "txn_expenses_insert" on expenses for insert to authenticated
  with check (public.is_manager() or branch_id = public.current_user_branch());
create policy "txn_expenses_update" on expenses for update to authenticated
  using (public.is_manager() or branch_id = public.current_user_branch())
  with check (public.is_manager() or branch_id = public.current_user_branch());
create policy "txn_expenses_delete" on expenses for delete to authenticated
  using (public.current_user_role() = 'dueno');

drop policy if exists "txn_purchases_select" on purchases;
drop policy if exists "txn_purchases_insert" on purchases;
drop policy if exists "txn_purchases_update" on purchases;
drop policy if exists "txn_purchases_delete" on purchases;
create policy "txn_purchases_select" on purchases for select to authenticated
  using (public.is_manager() or branch_id = public.current_user_branch());
create policy "txn_purchases_insert" on purchases for insert to authenticated
  with check (public.is_manager() or branch_id = public.current_user_branch());
create policy "txn_purchases_update" on purchases for update to authenticated
  using (public.is_manager() or branch_id = public.current_user_branch())
  with check (public.is_manager() or branch_id = public.current_user_branch());
create policy "txn_purchases_delete" on purchases for delete to authenticated
  using (public.current_user_role() = 'dueno');

-- suppliers: catálogo global, todos los usuarios de la tienda lo administran
drop policy if exists "suppliers_select" on suppliers;
drop policy if exists "suppliers_insert" on suppliers;
drop policy if exists "suppliers_update" on suppliers;
drop policy if exists "suppliers_delete" on suppliers;
create policy "suppliers_select" on suppliers for select to authenticated
  using (public.has_profile());
create policy "suppliers_insert" on suppliers for insert to authenticated
  with check (true);
create policy "suppliers_update" on suppliers for update to authenticated
  using (true)
  with check (true);
create policy "suppliers_delete" on suppliers for delete to authenticated
  using (public.current_user_role() = 'dueno');

-- mermas: por sucursal, como los gastos
drop policy if exists "txn_mermas_select" on mermas;
drop policy if exists "txn_mermas_insert" on mermas;
drop policy if exists "txn_mermas_update" on mermas;
drop policy if exists "txn_mermas_delete" on mermas;
create policy "txn_mermas_select" on mermas for select to authenticated
  using (public.is_manager() or branch_id = public.current_user_branch());
create policy "txn_mermas_insert" on mermas for insert to authenticated
  with check (public.is_manager() or branch_id = public.current_user_branch());
create policy "txn_mermas_update" on mermas for update to authenticated
  using (public.is_manager() or branch_id = public.current_user_branch())
  with check (public.is_manager() or branch_id = public.current_user_branch());
create policy "txn_mermas_delete" on mermas for delete to authenticated
  using (public.current_user_role() = 'dueno');

drop policy if exists "txn_shifts_select" on shifts;
drop policy if exists "txn_shifts_insert" on shifts;
drop policy if exists "txn_shifts_update" on shifts;
drop policy if exists "txn_shifts_delete" on shifts;
create policy "txn_shifts_select" on shifts for select to authenticated
  using (public.is_manager() or branch_id = public.current_user_branch());
create policy "txn_shifts_insert" on shifts for insert to authenticated
  with check (public.is_manager() or branch_id = public.current_user_branch());
create policy "txn_shifts_update" on shifts for update to authenticated
  using (public.is_manager() or branch_id = public.current_user_branch())
  with check (public.is_manager() or branch_id = public.current_user_branch());
create policy "txn_shifts_delete" on shifts for delete to authenticated
  using (public.current_user_role() = 'dueno');

drop policy if exists "txn_counts_select" on inventory_counts;
drop policy if exists "txn_counts_insert" on inventory_counts;
drop policy if exists "txn_counts_update" on inventory_counts;
drop policy if exists "txn_counts_delete" on inventory_counts;
create policy "txn_counts_select" on inventory_counts for select to authenticated
  using (public.is_manager() or branch_id = public.current_user_branch());
create policy "txn_counts_insert" on inventory_counts for insert to authenticated
  with check (public.is_manager() or branch_id = public.current_user_branch());
create policy "txn_counts_update" on inventory_counts for update to authenticated
  using (public.is_manager() or branch_id = public.current_user_branch())
  with check (public.is_manager() or branch_id = public.current_user_branch());
create policy "txn_counts_delete" on inventory_counts for delete to authenticated
  using (public.current_user_role() = 'dueno');

-- month_closings: lectura por sucursal, escritura SOLO admin -----------------

drop policy if exists "closings_select" on month_closings;
drop policy if exists "closings_admin_write" on month_closings;
create policy "closings_select" on month_closings for select to authenticated
  using (public.is_manager() or branch_id = public.current_user_branch());
create policy "closings_admin_write" on month_closings for all to authenticated
  using (public.is_manager())
  with check (public.is_manager());

-- ---------------------------------------------------------------------------
-- Índices (sync incremental y reportes)
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
create index if not exists idx_returns_updated on returns (updated_at);
create index if not exists idx_returns_branch_created on returns (branch_id, created_at);
create index if not exists idx_returns_sale on returns (sale_id);
create index if not exists idx_expenses_updated on expenses (updated_at);
create index if not exists idx_expenses_branch on expenses (branch_id);
create index if not exists idx_purchases_updated on purchases (updated_at);
create index if not exists idx_purchases_branch on purchases (branch_id);
create index if not exists idx_suppliers_updated on suppliers (updated_at);
create index if not exists idx_mermas_updated on mermas (updated_at);
create index if not exists idx_mermas_branch on mermas (branch_id);
create index if not exists idx_shifts_updated on shifts (updated_at);
create index if not exists idx_shifts_branch on shifts (branch_id);
create index if not exists idx_closings_updated on month_closings (updated_at);
create index if not exists idx_counts_updated on inventory_counts (updated_at);
create index if not exists idx_counts_branch on inventory_counts (branch_id);

-- ---------------------------------------------------------------------------
-- Perfiles de ejemplo: crea primero los usuarios en Authentication > Users
-- y ajusta los correos antes de ejecutar este bloque.
-- ---------------------------------------------------------------------------

-- insert into profiles (user_id, name, role, branch_id)
-- select id, 'Administrador', 'admin', null
-- from auth.users
-- where email = 'admin@tutienda.com'
-- on conflict (user_id) do update set role = 'admin', updated_at = now();

-- insert into profiles (user_id, name, role, branch_id)
-- select id, 'Vendedor', 'empleado', 'sucursal-1'
-- from auth.users
-- where email = 'vendedor@tutienda.com'
-- on conflict (user_id) do update set role = 'empleado', branch_id = 'sucursal-1', updated_at = now();

-- ---------------------------------------------------------------------------
-- Tiempo real (mismo contenido que supabase/migracion-realtime.sql)
-- ---------------------------------------------------------------------------

do $$
declare
  t text;
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    create publication supabase_realtime;
  end if;
  foreach t in array array[
    'branches', 'suppliers', 'products', 'product_stocks', 'customers', 'sales', 'returns',
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
