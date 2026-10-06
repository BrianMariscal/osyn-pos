# Decisión comercial: cómo vender Abarrotes POS

Fecha: 2026-09-07 · Estado: recomendación

## Objetivo

Vender el POS a otras tiendas sin comprometer los datos de cada cliente.

## Lo que el sistema ya resuelve

- Login con correo/contraseña (Supabase Auth) y roles: **admin** y **vendedor**.
- El RLS separa datos **por sucursal** dentro de una misma tienda, pero el
  esquema NO es multi-tenant: no existe un `store_id`/tenant que aisle a un
  negocio completo del otro.
- El código del cliente (`public/config.js`) apunta a UNA instancia de Supabase.

Conclusión: **hoy no es seguro (ni correcto) correr dos clientes distintos sobre
la misma base de Supabase.** Los catálogos y proveedores son globales.

## Opciones

### 1. Copia por cliente (recomendada para arrancar)

Cada tienda tiene su propia instancia aislada:

- Su propio proyecto de Supabase (schema único, sin sucursales extra).
- Su propio despliegue/URL en Vercel con `config.js` apuntando a su proyecto.
- Instalación: crear proyecto → ejecutar `supabase/schema.sql` → correr
  `scripts/setup-usuarios.mjs` para crear admin/vendedor iniciales.

**Ventajas**

- Aislamiento total y simple: el RLS y las políticas actuales son suficientes.
- Cero cambios de arquitectura; se puede vender ya.
- Precio de entrada bajo; la mensualidad cubre soporte.

**Desventajas**

- Mantener N proyectos Supabase/Vercel (una por cliente).
- No hay panel central para ver clientes ni métricas.
- Cada actualización de la app se publica una vez en el código (Vercel) y no
  por cliente; los cambios de esquema hay que aplicarlos por cliente.

### 2. SaaS multi-negocio (cuando haya varios clientes)

Una sola base con tenant:

- Agregar `store_id` (tenant) a todas las tablas y una tabla `stores`.
- RLS por tenant usando una claim/función que derive el negocio del perfil.
- Panel admin para crear negocios, planes y facturación.

**Ventajas**

- Un solo despliegue; onboarding 100% automatizado.
- Escala a muchos clientes con poco costo marginal.

**Desventajas**

- Rediseño de datos + migración (stock/sucursal/tenant) no trivial.
- Más riesgo de fuga entre tenants si una policy falla.
- Mucho más trabajo antes del primer ingreso.

## Recomendación

**Empezar con la opción 1 (copia por cliente).** Es la vía más rápida para
validar el producto con 2-3 tiendas reales y cobrar. Diseñar la opción 2 solo
cuando haya demanda probada (por ejemplo, 10+ clientes) y la mensualidad justifique
la inversión; en ese momento se migra con un script por cliente.

## Modelo de cobro sugerido

| Concepto | Precio sugerido |
|---|---|
| Instalación + carga inicial | $1,500 MXN |
| Personalización (logo, catálogo, capacitación) | $2,500 – $4,000 MXN |
| Mensualidad soporte/sistema | $299 MXN |
| Soporte premium | $599 MXN/mes |

## Checklist antes de vender (por cliente)

1. Crear proyecto Supabase y aplicar `supabase/schema.sql` (bases nuevas crean
   UNA sucursal por defecto: "Sucursal 1").
2. Crear el admin inicial con `scripts/setup-usuarios.mjs` (nunca en el navegador
   del cliente).
3. Copiar la app en Vercel (o repositorio por cliente) con el `config.js`
   apuntando a ese proyecto; guardar las variables `SUPABASE_URL`,
   `SUPABASE_ANON_KEY` y `SUPABASE_SERVICE_ROLE_KEY` de ese cliente en el entorno.
4. Verificar RLS: usuarios autenticados solo tocan su sucursal; escritura de
   catálogo/proveedores/sucursales = admin (el vendedor solo vende/entra).
5. Capacitar: login, venta, corte, fiado, respaldo/exportar.
6. Dar acceso al respaldo manual (Ajustes > Exportar) y explicar el uso offline.

## Pendientes de seguridad a corto plazo

- Rotar/revocar la `service_role` que estuvo en texto plano en la máquina de
  desarrollo (aunque quedó fuera de git).
- (Recomendado, antes del primer cliente real) funciones RPC atómicas para
  stock/saldo: elimina por completo la carrera entre dispositivos que hoy se
  mitiga con rebase por deltas (ver `src/data/repositories.ts`).
