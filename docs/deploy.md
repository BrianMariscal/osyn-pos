# Despliegue

Producción: **Cloudflare Pages** (proyecto `osynpos`, dominio osynpos.shop),
plan gratuito con uso comercial permitido.

## Build y despliegue

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
| `ELEVENLABS_API_KEY` | Voz del asistente (la clave necesita los permisos `voices_read` y `text_to_speech`) |
| `UPSTASH_REDIS_REST_URL` y `UPSTASH_REDIS_REST_TOKEN` | Opcional (Upstash gratis): límite de solicitudes compartido entre instancias. Sin ellas se cuenta en memoria |

## Monitoreo

Monitoreo de errores (opcional, Sentry gratis): pon el DSN en `sentryDsn` de
`public/config.js`. Sin DSN no se carga nada.

## CI y respaldos

Respaldos diarios y pruebas automáticas corren en GitHub Actions
(`.github/workflows/`). Configuración y restauración en
[respaldos.md](respaldos.md).

Sin las llaves de IA el resto de la app funciona normal; el asistente responde
con el parser local.
