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
