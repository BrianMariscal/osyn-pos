# Abarrotes POS

Punto de venta web (PWA) para tiendas de abarrotes: venta rápida con voz y
escáner, inventario, fiado, gastos, compras a proveedores, mermas, corte de
caja, reportes en PDF y respaldo en la nube. Funciona **offline** (todo queda
en el dispositivo) y se puede instalar como app en Android.

## Características

- **Venta** con buscador, escáner de código y dictado por voz ("dos cocas, una leche").
- **Fiado** con clientes, cargos, pagos e historial de movimientos.
- **Inventario** con entradas de mercancía, mermas, conteos físicos y aviso de mínimos.
- **Corte de caja** con arqueo, diferencia y envío del resumen por WhatsApp.
- **Reportes** diarios/mensuales, ganancia, y exportación a PDF.
- **Asistente por chat** que responde con datos reales (ventas, caja, fiado) y puede registrar gastos.
- **Multi-dispositivo**: PC, celular y tablet sincronizados.
- **Offline real**: cada venta se guarda en el dispositivo y se sincroniza al volver la conexión; los conflictos de stock/saldo se rebasan sin perder ventas offline.
- **Sucursales**: una por defecto; el dueño agrega más cuando quiera, cada una con su propio stock, ventas y caja (catálogo compartido).
- **Roles**: admin y vendedor (el admin decide qué pantallas ve cada vendedor).

## Stack

- Frontend: TypeScript modular + Vite + PWA (service worker offline).
- Datos: IndexedDB en el dispositivo + Supabase (Postgres + Auth + RLS) como nube.
- Backend ligero: funciones en `api/` servidas por Cloudflare Pages Functions (asistente IA, voz y usuarios).
- Tests: Vitest.

## Desarrollo

```bash
npm install
npm run dev          # servidor local (http://localhost:5173)
npm run check        # lint + typecheck + tests (validación pre-producción)
npm test             # tests (Vitest)
npm run typecheck    # chequeo de tipos
npm run lint         # ESLint
npm run build        # typecheck + build de producción en dist/
```

## Estructura

```
src/
  core/     tipos, dinero (centavos enteros), fechas con zona local, HTML seguro
  domain/   store reactivo + servicios (venta, fiado, inventario, corte, reportes, sucursales)
  data/     IndexedDB, cliente Supabase, sync engine incremental y rebase de contadores
  ai/       cliente del asistente
  ui/       shell, componentes (modal/toast) y una pestaña por módulo
  styles/   design system (tokens + componentes)
api/          funciones serverless (asistente, voz, usuarios) con forma req/res de Node
functions/    adaptador de Cloudflare Pages que sirve api/ en /api/*
supabase/     schema.sql, migraciones y verificacion.sql (qué protecciones tiene la base)
public/       config.js (llaves públicas), _headers (seguridad), íconos, assetlinks (Android)
tests/        pruebas de Vitest
docs/         decisiones y guías (respaldos, modelo comercial)
.github/      CI (lint, tipos, pruebas, build) y respaldo diario cifrado
```

## Supabase (nueva instalación)

1. Crea un proyecto en Supabase.
2. En **SQL Editor** ejecuta `supabase/schema.sql`. Las bases nuevas crean **una
   sola sucursal** ("Sucursal 1"); el dueño agrega más desde la app
   (Ajustes > Sucursales).
3. Crea el dueño, un administrador y un vendedor inicial (Node 18+):
   ```bash
   node scripts/setup-usuarios.mjs --url https://TU-PROYECTO.supabase.co --service-role TU_SERVICE_ROLE --anon TU_ANON_KEY \
     --dueno-email dueno@tutienda.com --dueno-password Dueno2026 \
     --admin-email admin@tutienda.com --admin-password Admin2026 \
     --vendedor-email vendedor@tutienda.com --vendedor-password Vendedor2026
   ```
   Roles: **dueño** (gestiona usuarios y sucursales), **administrador** (opera
   la tienda: ventas, inventario, cortes, reportes y ajustes, sin gestionar
   usuarios/sucursales) y **vendedor** (solo sus pantallas y su sucursal).
   La `service_role` es secreta: solo en el servidor, nunca en git.
4. Sin `--anon`, pega la `Project URL` y la `anon key` en `public/config.js`.

 5. Para que los cambios se vean **al instante** en todos los dispositivos,
    ejecuta `supabase/migracion-realtime.sql` en el SQL Editor (una sola vez).
    Sin este paso la app sincroniza igual, revisando cada pocos segundos.

 6. Ejecuta `supabase/migracion-guardias-fiado.sql` y
    `supabase/migracion-precios-servidor.sql` (después de
    `supabase/migracion-stock-servidor.sql`): un vendedor ya no puede alterar
    saldos de fiado ni registrar ventas debajo del costo o con cantidades inválidas.
 7. Corre `supabase/verificacion.sql` (solo lectura): cada renglón debe decir
    **OK**; si dice **FALTA**, indica qué archivo aplicar.

 > ¿Base ya existente con datos? Aplica `supabase/migracion-multisucursal.sql`
 > para pasar a esquema multi-sucursal sin perder información (respáldala antes).
 > Después aplica `supabase/migracion-endurecimiento.sql` para restringir el
 > catálogo de proveedores y validar cantidades y montos no negativos.
 > Para asignar administradores a una sucursal, aplica también
 > `supabase/migracion-admin-sucursal.sql`: un administrador con sucursal solo
 > ve y opera esa sucursal; sin sucursal sigue viendo todas.

## Sincronización y offline

- Todo se guarda primero en IndexedDB y después se sube/baja por tabla con
  cambios incrementales (las tablas se descargan en paralelo).
- Tiempo real: con `supabase/migracion-realtime.sql` aplicado, cada cambio en
  otro dispositivo dispara la sync en ~1 s (WebSocket de Supabase Realtime).
  Sin él, se revisa cada 8 s mientras la app está visible.
- El pull relee los últimos 10 minutos para tolerar relojes desfasados entre
  dispositivos (el merge es idempotente).
- Los borrados se propagan con tombstones y el conflicto se resuelve
  last-write-wins por `updated_at`.
- Los contadores mutables (`stock`, saldo de fiado) se protegen: si hay un
  cambio local sin subir y la nube avanzó, el delta local se aplica sobre el
  valor nuevo de la nube en lugar de perderse.

## Despliegue

Producción: **Cloudflare Pages** (proyecto `osynpos`, dominio osynpos.shop), plan
gratuito con uso comercial permitido.

```bash
npm run deploy:cf    # build + wrangler pages deploy
```

Las cabeceras de seguridad viven en `public/_headers`. Las variables se ponen en
Cloudflare → Workers & Pages → osynpos → Settings → Variables and Secrets:

| Variable | Para qué |
|---|---|
| `SUPABASE_URL` | Valida sesiones y usuarios en `api/*` |
| `SUPABASE_ANON_KEY` | Ídem |
| `SUPABASE_SERVICE_ROLE_KEY` | Crear/editar usuarios desde `api/*` (secreta) |
| `NVIDIA_API_KEY` o `OPENAI_API_KEY` | Motor del asistente (chat) |
| `ELEVENLABS_API_KEY` | Voz del asistente |
| `UPSTASH_REDIS_REST_URL` y `UPSTASH_REDIS_REST_TOKEN` | Opcional (Upstash gratis): límite de solicitudes compartido entre instancias. Sin ellas se cuenta en memoria |

Monitoreo de errores (opcional, Sentry gratis): pon el DSN en `sentryDsn` de
`public/config.js`. Sin DSN no se carga nada.

Respaldos diarios y pruebas automáticas corren en GitHub Actions
(`.github/workflows/`). Configuración y restauración en `docs/respaldos.md`.

Sin esas llaves el resto de la app funciona normal; el asistente de IA responde
con el parser local.

## Comercialización

Modelo recomendado: **una copia (Supabase + despliegue) por cliente**. Detalles,
modelo de cobro y checklist por cliente en `docs/decision-comercial.md`.

## Notas de seguridad

- Las llaves públicas (`anon`) viven en `public/config.js` por diseño.
- La `service_role` nunca debe ir al navegador ni al repositorio.
- RLS activo en todas las tablas: cada usuario autenticado solo accede a su
  sucursal; catálogo y sucursales los administra el admin.
- Endpoints de `api/` validan sesión (JWT contra Supabase), verifican rol admin
  cuando corresponde, aplican rate limit por IP y acotan tamaños de entrada.
- Cabeceras de seguridad en producción (CSP estricta, `nosniff`, `DENY` frames,
  políticas de permisos para micrófono/cámara).

### Antes de dar de alta un cliente nuevo

1. Rotar/regenerar la `service_role` si estuvo en texto plano en algún
   respaldo o máquina de desarrollo (Supabase → Settings → API keys).
2. En la tienda del cliente, decidir si los vendedores pueden crear productos y
   editar proveedores (hoy sí pueden por política de RLS); si no, restringirlo.
