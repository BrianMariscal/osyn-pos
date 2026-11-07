-- OSYN POS: los administradores también configuran sus sucursales.
-- Ejecutar UNA vez en Supabase › SQL Editor (después de las migraciones anteriores).
--
-- Ajustes › Sucursales ahora lo ven el dueño y los administradores, y ahí se
-- configura el WhatsApp del corte y el cierre automático de cada sucursal:
--   * Dueño                       → todas las sucursales (y las crea).
--   * Administrador SIN sucursal  → todas las sucursales.
--   * Administrador CON sucursal  → solo la suya.
--   * Vendedor                    → ninguna.
--
-- La app sube los cambios con "upsert" (INSERT … ON CONFLICT DO UPDATE), que
-- exige permiso de INSERT además del de UPDATE; por eso se crean las dos reglas.
-- También limpia la política vieja "branches_admin_write" (administradores sin
-- límite de sucursal) si quedó de una instalación anterior.
-- Es seguro ejecutarlo más de una vez.

-- El dueño escribe todas las sucursales (se recrea por si la instalación quedó
-- sin esta regla; es la misma definición del esquema).
drop policy if exists "branches_owner_write" on branches;
create policy "branches_owner_write" on branches for all to authenticated
  using (public.current_user_role() = 'dueno')
  with check (public.current_user_role() = 'dueno');

-- Política vieja (de migracion-multisucursal.sql): administradores sin alcance.
drop policy if exists "branches_admin_write" on branches;

drop policy if exists "branches_manager_insert" on branches;
create policy "branches_manager_insert" on branches for insert to authenticated
  with check (
    public.current_user_role() in ('dueno', 'admin')
    and (public.current_user_branch() is null or id = public.current_user_branch())
  );

drop policy if exists "branches_manager_update" on branches;
create policy "branches_manager_update" on branches for update to authenticated
  using (
    public.current_user_role() in ('dueno', 'admin')
    and (public.current_user_branch() is null or id = public.current_user_branch())
  )
  with check (
    public.current_user_role() in ('dueno', 'admin')
    and (public.current_user_branch() is null or id = public.current_user_branch())
  );

-- Revisión: deben aparecer branches_owner_write, branches_manager_insert y
-- branches_manager_update.
select tablename, policyname, cmd, qual, with_check
from pg_policies
where schemaname = 'public' and tablename = 'branches'
order by policyname;
