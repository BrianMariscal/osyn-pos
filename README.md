# OSYN POS

**SaaS offline-first** con sincronización distribuida, multi-tenant por instancia, RLS por sucursal y asistente IA en producción.

Punto de venta para tiendas de abarrotes que sigue vendiendo sin internet: cada
venta se guarda en el dispositivo y se sincroniza entre PC, celular y tablet al
volver la conexión.

🔴 **En producción:** [osynpos.shop](https://osynpos.shop)

[![CI](https://github.com/BrianMariscal/osyn-pos/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/BrianMariscal/osyn-pos/actions/workflows/ci.yml)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.6-3178C6?logo=typescript&logoColor=white)](#stack)
[![Supabase](https://img.shields.io/badge/Supabase-Postgres%20%2B%20RLS-3ECF8E?logo=supabase&logoColor=white)](#stack)
[![Cloudflare Pages](https://img.shields.io/badge/Cloudflare-Pages%20Functions-F38020?logo=cloudflare&logoColor=white)](#stack)
[![PWA](https://img.shields.io/badge/PWA-offline--first-5A0FC8)](#stack)

## Arquitectura

![Arquitectura de OSYN POS: PWA → IndexedDB → Sync Engine → Supabase, con Cloudflare Pages Functions para IA y voz](docs/assets/arquitectura.png)

> En el dispositivo, la PWA escribe primero en IndexedDB y el Sync Engine sube
> deltas a Supabase. En la nube, Cloudflare Pages sirve la app y las funciones
> de IA/voz; GitHub Actions ejecuta CI y respaldos cifrados.

## Decisiones clave

- **Offline-first real, no un “modo offline”.** La venta se escribe primero en
  IndexedDB; el Sync Engine sube cambios incrementales y rebasa contadores
  mutables (stock y fiado) para no perder operaciones hechas sin red.
- **Aislamiento por instancia y RLS por sucursal.** Cada cliente tiene su propia
  instancia de Supabase + Cloudflare. Dentro de la tienda, RLS, JWT y roles
  (dueño, admin, vendedor) limitan cada dato a su sucursal: el catálogo se
  comparte, pero stock, ventas y caja no.
- **Sincronización distribuida idempotente.** Tombstones para borrados,
  last-write-wins por `updated_at`, pull de los últimos 10 minutos para tolerar
  relojes desfasados y descarga de tablas en paralelo. Realtime baja la latencia
  a ~1 s; sin Realtime, polling cada 8 s.
- **IA sobre datos reales, con degradación elegante.** El asistente consulta
  ventas, caja y fiado mediante funciones serverless que validan el JWT; si no
  hay llaves de IA, un parser local mantiene la venta por voz.
- **CI/CD y respaldos desde el día uno.** GitHub Actions corre lint, tipos,
  tests y build en cada push, y respalda Supabase a diario con `pg_dump`
  cifrado y retención de 90 días.

Los límites de estas decisiones están documentados en
[Limitaciones y trade-offs](#limitaciones-conocidas-y-trade-offs).

## Demo: venta offline y sincronización

![Venta de 3 productos sin internet, 4 cambios pendientes y sincronización al reconectar](docs/assets/demo-offline-sync.gif)

> **DEMO · DATOS DE EJEMPLO.** Grabada con el frontend y el Sync Engine reales
> y un backend Supabase simulado, para mostrar el flujo sin exponer datos de
> clientes. No es una captura de la instancia de producción.
>
> La secuencia corta la red, vende 3 productos ($45.00), muestra **4 cambios
> pendientes** y, al reconectar, termina en **Todo sincronizado**. En
> producción el pull lo dispara Supabase Realtime (~1 s); el polling de
> respaldo es de 8 s.

## Métricas y evidencia

| Métrica | Valor | Cómo verificarla |
|---|---:|---|
| Pruebas automatizadas | **185** en 27 archivos | `npm test` y CI en cada push |
| Tablas con RLS | **14/14** · 52 políticas | [`supabase/schema.sql`](supabase/schema.sql) |
| Sync con Realtime | **~1 s** (objetivo) | [`supabase/migracion-realtime.sql`](supabase/migracion-realtime.sql) |
| Polling de respaldo | **8 s** (60 s con Realtime activo) | [`src/ui/shell/sync.ts`](src/ui/shell/sync.ts) |
| Respaldo cifrado | diario · AES-256 · **90 días** | [`.github/workflows/backup.yml`](.github/workflows/backup.yml) |
| RPO de respaldo | **≤ 24 h** (objetivo) | ejecución diaria a las 03:15 CT |
| Producción | [osynpos.shop](https://osynpos.shop) | Cloudflare Pages |

> **Datos de negocio:** tiendas activas, ventas sincronizadas y latencia real
> medida no se publican aquí para no exponer datos de clientes ni inventar
> cifras. Son métricas del operador, no del repositorio.

## Limitaciones conocidas y trade-offs

Un sistema maduro no es el que no tiene límites, sino el que sabe dónde están.
Estos son los que acepté a cambio de velocidad, disponibilidad y aislamiento.

### LWW, no CRDT

La resolución de conflictos es **last-write-wins por fila** usando `updated_at`,
con rebase por deltas para los contadores mutables (stock y saldo de fiado). No
hay CRDT.

- **Por qué:** las ventas son append-only, cada sucursal tiene su propio stock y
  la edición simultánea del mismo campo es rara. Un CRDT (Yjs, Automerge)
  habría añadido metadatos, almacenamiento y complejidad operativa para un
  problema que casi no existe en este dominio.
- **Límite:** si dos dispositivos editan el mismo campo de un producto sin red,
  gana el `updated_at` más reciente y la otra edición se descarta. Los
  contadores no se pierden porque se reaplican como delta, pero un cambio de
  precio o nombre sí puede perderse.
- **Mitigación:** la UI muestra pendientes y errores de sync; las ventas no
  compiten entre sí porque cada una es una fila nueva.

### Consistencia eventual, no transacciones distribuidas

Una venta se confirma localmente aunque el servidor no esté disponible. El
stock y el fiado se ajustan al sincronizar, no en el momento de la venta.

- **Por qué:** disponibilidad primero. Bloquear el cobro sin red es peor para
  una tienda que reconciliar después.
- **Límite:** dos cajas offline pueden vender la última pieza y sobrevender
  hasta que ambas sincronicen. El servidor rechaza filas que violan RLS o
  restricciones y la app avisa, pero no hay reserva anticipada de stock.
- **Pendiente:** mover stock y fiado a una función RPC atómica en Postgres. Hoy
  se mitiga con rebase por deltas y guardias en la base; no es equivalente a
  una transacción distribuida.

### Una instancia por cliente

Cada tienda tiene su propio proyecto de Supabase y su propio despliegue de
Cloudflare. No hay un `tenant_id` compartido.

- **Por qué:** aislamiento total con el RLS actual, sin rediseño y con riesgo
  de fuga entre clientes prácticamente nulo.
- **Límite:** el costo operativo crece O(n): migraciones, monitoreo, respaldos
  y rotación de llaves por cliente. Tampoco hay un panel central con métricas
  de todos los clientes.
- **Cuándo cambiar:** al llegar a ~10 clientes o cuando el onboarding manual
  sea el cuello de botella; el plan está en
  [`docs/decision-comercial.md`](docs/decision-comercial.md).

### Tombstones sin compactación

Los borrados se propagan con `deleted = true`; no se eliminan físicamente ni
hay un job de compactación.

- **Por qué:** un tombstone es idempotente y sobrevive a dispositivos que
  estuvieron offline mucho tiempo.
- **Límite:** las tablas crecen con filas borradas y todas las consultas deben
  filtrar `deleted`. Con el volumen de una tienda no es un problema hoy; a
  mayor escala haría falta compactar después de una ventana de sync.

### Reportes calculados en el cliente

Los reportes y cortes se calculan en el dispositivo sobre las ventas ya
sincronizadas, no con agregaciones SQL en el servidor.

- **Por qué:** funciona offline, es simple y evita otra capa de caché.
- **Límite:** cada dispositivo descarga las tablas que necesita y agrega en
  memoria. Con muchos años de ventas o miles de sucursales habría que mover
  los reportes a vistas materializadas o RPC. Para una tienda de abarrotes con
  historial acotado, el trade-off es correcto.

### Dependencias externas: IA y Realtime

- **IA y voz:** el asistente en la nube y la voz cloud dependen de llaves de
  terceros (LLM y ElevenLabs). Sin llaves, la app degrada a un parser local y a
  la voz del dispositivo; el POS sigue funcionando. Los resultados de IA no son
  deterministas y están sujetos a rate limit y costo.
- **Realtime:** si Supabase Realtime no está disponible, la app cae a polling
  cada 8 s. La sync sigue funcionando, pero la latencia percibida sube.

### Respaldo y durabilidad local

El respaldo es un `pg_dump` diario cifrado con AES-256 y retención de 90 días.
No hay PITR configurado.

- **RPO:** hasta 24 h de datos ante un desastre. IndexedDB conserva el estado
  en cada dispositivo y se puede exportar manualmente; el respaldo diario
  cubre el resto. Subir a PITR es una decisión de costo, no de código.
- **Durabilidad en el dispositivo:** la app pide almacenamiento persistente
  (`navigator.storage.persist()`), pero el navegador puede desalojarlo si el
  equipo está sin espacio, y borrar los datos del sitio elimina lo no
  sincronizado. Un dispositivo perdido antes de sincronizar puede perder
  ventas; por eso la UI muestra los pendientes y sincroniza al reconectar.

## Stack

`TypeScript` · `Vite` · `PWA` · `IndexedDB` · `Supabase (Postgres, Auth, Realtime, RLS)` · `Cloudflare Pages Functions` · `ElevenLabs` · `Vitest`

## Desarrollo

```bash
npm install
npm run dev     # http://localhost:5173
npm run check   # lint + tipos + tests
```

## Seguridad

- **RLS en todas las tablas:** cada usuario autenticado solo accede a su
  sucursal; catálogo y sucursales los administra el admin.
- **JWT validado en el servidor:** los endpoints de `api/` verifican la sesión
  contra Supabase, comprueban el rol admin cuando aplica y aplican rate limit
  por IP con límites de entrada.
- **`service_role` aislada:** vive solo como secreto en Cloudflare; nunca en el
  navegador ni en el repositorio.
- **Cabeceras estrictas en producción:** CSP, `nosniff`, `DENY` para frames y
  política de permisos para micrófono y cámara.
- **Defensa en profundidad:** guardias en la base para stock, precios,
  cantidades, fiado y devoluciones, además de respaldos cifrados diarios.

## Documentación

| Guía | Contenido |
|---|---|
| [Instalación de Supabase](docs/setup-supabase.md) | Crear el proyecto, aplicar schema/migraciones y usuarios iniciales |
| [Despliegue](docs/deploy.md) | Cloudflare Pages, variables, secretos y monitoreo |
| [Modelo comercial](docs/comercial.md) | Venta por cliente, precios y checklist de alta |
| [Respaldos](docs/respaldos.md) | Configurar, restaurar y verificar el respaldo diario |
| [Decisión comercial detallada](docs/decision-comercial.md) | Opciones de arquitectura, cobro y pendientes |

## Características

- **Venta** con buscador, escáner de código y dictado por voz ("dos cocas, una leche").
- **Venta a granel**: por peso o litros (g/kg, ml/L) o por importe ("$20 de
  jitomate") con conversión automática a dinero.
- **Devoluciones**: busca la venta por folio, elige los renglones y cantidades
  (acepta devoluciones parciales); el stock regresa al inventario y el reembolso
  se descuenta de la caja, o se abona al fiado del cliente.
- **Fiado** con clientes, cargos, pagos (incluidos los parciales) e historial de movimientos.
- **Inventario** con entradas de mercancía, mermas, conteos físicos y aviso de mínimos.
- **Corte de caja** con arqueo, diferencia, historial con detalle de cada corte,
  **corte de un día pasado** (cierra pendientes sin tocar las ventas de hoy),
  **cierre automático a medianoche** si no se hizo manualmente y envío del
  resumen por WhatsApp a los números de la sucursal.
- **Reportes** diarios/mensuales, ganancia, y exportación a PDF.
- **Asistente por chat** que responde con datos reales (ventas, caja, fiado) y puede registrar gastos.
- **Multi-dispositivo**: PC, celular y tablet sincronizados.
- **Offline real**: cada venta se guarda en el dispositivo y se sincroniza al volver la conexión; los conflictos de stock/saldo se rebasan sin perder ventas offline.
- **Sucursales**: una por defecto; el dueño agrega más cuando quiera, cada una con su propio stock, ventas y caja (catálogo compartido). En Ajustes › Sucursales se configuran (el dueño, o el administrador en la suya) hasta dos números de WhatsApp para recibir cada corte y el cierre automático a medianoche.
- **Roles**: admin y vendedor (el admin decide qué pantallas ve cada vendedor).

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
docs/         guías de instalación, despliegue, comercial, respaldos y arquitectura
.github/      CI (lint, tipos, pruebas, build) y respaldo diario cifrado
```
