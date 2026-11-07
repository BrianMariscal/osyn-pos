-- OSYN POS: solo los usuarios con perfil en la tienda leen datos.
-- Ejecutar en Supabase SQL Editor (se puede correr más de una vez).
--
-- El registro de Supabase Auth puede quedar abierto: cualquiera con la clave
-- pública crea una cuenta "authenticated" sin fila en profiles. Las tablas por
-- sucursal ya la excluyen (branch_id = current_user_branch() es null), pero el
-- catálogo, las sucursales, los proveedores y los ajustes (WhatsApp, logo) se
-- leían con using (true). Aquí se exige tener rol.

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

drop policy if exists "products_select" on products;
create policy "products_select" on products for select to authenticated
  using (public.has_profile());

drop policy if exists "branches_select" on branches;
create policy "branches_select" on branches for select to authenticated
  using (public.has_profile());

drop policy if exists "suppliers_select" on suppliers;
create policy "suppliers_select" on suppliers for select to authenticated
  using (public.has_profile());

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

grant execute on function public.pos_settings() to authenticated;

notify pgrst, 'reload schema';

-- Verificación: las 3 políticas deben decir has_profile().
select tablename, policyname, qual
from pg_policies
where schemaname = 'public' and policyname in ('products_select', 'branches_select', 'suppliers_select')
order by 1;
