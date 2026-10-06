-- Abarrotes POS: administradores asignados a una sucursal.
-- Ejecutar UNA vez en Supabase › SQL Editor (después de las migraciones anteriores).
--
-- Antes: cualquier administrador leía y escribía datos de TODAS las sucursales.
-- Ahora:
--   * Dueño                          → todas las sucursales.
--   * Administrador SIN sucursal     → todas las sucursales (como antes).
--   * Administrador CON sucursal     → solo su sucursal (ventas, inventario, fiado,
--                                      gastos, compras, mermas, cortes…).
--   * Vendedor                       → solo su sucursal (sin cambios).
-- El catálogo (productos, proveedores) sigue siendo compartido.
-- Es seguro ejecutarlo más de una vez.

create or replace function public.pos_all_branches()
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select coalesce(
    (select role = 'dueno' or (role = 'admin' and branch_id is null)
       from public.profiles where user_id = auth.uid()),
    false
  )
$$;

-- Las reglas por sucursal tienen la forma "is_manager() OR branch_id = current_user_branch()".
-- Se cambia is_manager() por pos_all_branches() solo en esas reglas: el admin con
-- sucursal pasa únicamente por "branch_id = su sucursal".
do $$
declare
  p record;
  new_qual text;
  new_check text;
begin
  for p in
    select schemaname, tablename, policyname, qual, with_check
    from pg_policies
    where schemaname = 'public'
      and (coalesce(qual, '') like '%current_user_branch()%' or coalesce(with_check, '') like '%current_user_branch()%')
  loop
    new_qual := p.qual;
    new_check := p.with_check;
    if new_qual is not null then
      new_qual := replace(replace(new_qual, 'public.is_manager()', 'public.pos_all_branches()'), 'is_manager()', 'pos_all_branches()');
      new_qual := replace(new_qual, '(current_user_role() = ''admin''::text)', 'pos_all_branches()');
    end if;
    if new_check is not null then
      new_check := replace(replace(new_check, 'public.is_manager()', 'public.pos_all_branches()'), 'is_manager()', 'pos_all_branches()');
      new_check := replace(new_check, '(current_user_role() = ''admin''::text)', 'pos_all_branches()');
    end if;
    if new_qual is distinct from p.qual then
      execute format('alter policy %I on %I.%I using (%s)', p.policyname, p.schemaname, p.tablename, new_qual);
    end if;
    if new_check is distinct from p.with_check then
      execute format('alter policy %I on %I.%I with check (%s)', p.policyname, p.schemaname, p.tablename, new_check);
    end if;
  end loop;
end $$;

-- Revisión: reglas por sucursal que quedaron (deben decir pos_all_branches()).
select tablename, policyname, qual, with_check
from pg_policies
where schemaname = 'public'
  and (coalesce(qual, '') like '%current_user_branch()%' or coalesce(with_check, '') like '%current_user_branch()%')
order by tablename, policyname;
