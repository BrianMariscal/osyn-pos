# Configuración interna de Supabase

> Documento interno de OSYN POS. Uso exclusivo del titular. No se autoriza su
> reproducción ni distribución a terceros.

Guía interna para aprovisionar la base de OSYN POS.

## Proyecto nuevo

1. Crea un proyecto en Supabase.
2. En **SQL Editor** ejecuta `supabase/schema.sql`. Las bases nuevas crean **una
   sola sucursal** ("Sucursal 1"); el dueño agrega más desde la app
   (Ajustes > Sucursales).
3. Crea el dueño, un administrador y un vendedor inicial (Node 18+):

   ```bash
   node scripts/setup-usuarios.mjs --url https://TU-PROYECTO.supabase.co --service-role TU_SERVICE_ROLE --anon TU_ANON_KEY \
     --dueno-email dueno@ejemplo.com --dueno-password 'CAMBIA_ESTA_CONTRASEÑA' \
     --admin-email admin@ejemplo.com --admin-password 'CAMBIA_ESTA_CONTRASEÑA' \
     --vendedor-email vendedor@ejemplo.com --vendedor-password 'CAMBIA_ESTA_CONTRASEÑA'
   ```

   Usa contraseñas únicas y largas; no reutilices las de ejemplo. Roles:
   **dueño** (gestiona usuarios y sucursales), **administrador** (opera la
   tienda: ventas, inventario, cortes, reportes y ajustes, sin gestionar
   usuarios/sucursales) y **vendedor** (solo sus pantallas y su sucursal). La
   `service_role` es secreta: solo en el servidor, nunca en git.

4. Sin `--anon`, pega la `Project URL` y la `anon key` en `public/config.js`.

5. Para que los cambios se vean **al instante** en todos los dispositivos,
   ejecuta `supabase/migracion-realtime.sql` en el SQL Editor (una sola vez).
   Sin este paso la app sincroniza igual, revisando cada pocos segundos.

6. Ejecuta `supabase/migracion-guardias-fiado.sql` y
   `supabase/migracion-precios-servidor.sql` (después de
   `supabase/migracion-stock-servidor.sql`): un vendedor ya no puede alterar
   saldos de fiado ni registrar ventas debajo del costo o con cantidades inválidas.

7. Ejecuta `supabase/migracion-devoluciones.sql` (después de las anteriores):
   crea la tabla de **devoluciones**, valida en el servidor que no se devuelva
   más de lo vendido y regresa el stock al inventario.

8. Corre `supabase/verificacion.sql` (solo lectura): cada renglón debe decir
   **OK**; si dice **FALTA**, indica qué archivo aplicar.

## Base existente con datos

> Aplica `supabase/migracion-multisucursal.sql` para pasar a esquema
> multi-sucursal sin perder información (respáldala antes).
>
> Después aplica `supabase/migracion-endurecimiento.sql` para restringir el
> catálogo de proveedores y validar cantidades y montos no negativos.
>
> Para asignar administradores a una sucursal, aplica también
> `supabase/migracion-admin-sucursal.sql`: un administrador con sucursal solo
> ve y opera esa sucursal; sin sucursal sigue viendo todas.
