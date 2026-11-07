# Changelog

> Documento interno de OSYN POS. Software propietario. Todos los derechos
> reservados.

## [Sin publicar]

### Documentación

- Documentación reorientada a la operación interna de OSYN POS.
- Aviso de propiedad intelectual y licencia propietaria.

## [1.0.0] - 2026-11-05

Primera versión estable de OSYN POS.

### Incluye

- PWA offline-first para tiendas de abarrotes: venta, inventario, fiado,
  compras, gastos, devoluciones, cortes y reportes.
- Operación sin internet con IndexedDB y Sync Engine incremental por
  `synced_at`, rebase de contadores y resolución last-write-wins.
- Multi-sucursal con RLS, JWT y roles de dueño, administrador y vendedor.
- Venta por pieza, caja, granel o importe; escáner, atajos y dictado por voz.
- Tickets en imagen para WhatsApp y envío del corte a los números de la
  sucursal.
- Asistente con datos reales y degradación a parser local si no hay llaves de
  IA.
- Cierre automático de medianoche desde un dispositivo con sesión de admin.
- Despliegue en Cloudflare Pages con CSP, cabeceras estrictas y rate limit por
  IP (Upstash Redis opcional).

### Operación y calidad

- CI con lint, tipos, pruebas y build en cada push.
- 186 pruebas automatizadas en 27 archivos; 26 del Sync Engine, con
  simulaciones de dos dispositivos.
- Respaldo diario cifrado con `pg_dump`, retención de 90 días y RPO ≤ 24 h.
- Documentación interna de instalación, despliegue, respaldos y arquitectura.

### Limitaciones conocidas

- LWW usa `updated_at` del dispositivo; un reloj desfasado puede perder una
  edición no acumulable. Falta que el servidor asigne `updated_at`.
- La RPC atómica para stock y fiado sigue pendiente; hoy se mitiga con rebase
  por deltas y guardias en la base.
- Sin Upstash, el rate limit es en memoria por instancia.
- No hay PITR; el respaldo tiene un RPO de hasta 24 h.

[1.0.0]: https://github.com/BrianMariscal/osyn-pos/releases/tag/v1.0.0
