# Modelo comercial

Modelo recomendado: **una copia (Supabase + despliegue) por cliente**.

Cada tienda tiene su propia instancia de Supabase y su propio despliegue en
Cloudflare Pages; el aislamiento entre negocios es total. Dentro de cada tienda,
el RLS separa además la información por sucursal.

Para el análisis de opciones, precios sugeridos y checklist de venta, consulta
[decision-comercial.md](decision-comercial.md).

## Antes de dar de alta un cliente nuevo

1. Rotar/regenerar la `service_role` si estuvo en texto plano en algún
   respaldo o máquina de desarrollo (Supabase → Settings → API keys).
2. En la tienda del cliente, decidir si los vendedores pueden crear productos y
   editar proveedores (hoy sí pueden por política de RLS); si no, restringirlo.
