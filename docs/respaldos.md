# Respaldos de la base

> Documento interno de OSYN POS. Uso exclusivo del titular. No se autoriza su
> reproducción ni distribución a terceros.

El flujo `.github/workflows/backup.yml` respalda la base de OSYN POS todos los
días a las 03:15 (hora del centro) y guarda el archivo cifrado 90 días en GitHub
(Actions > Respaldo diario > Artifacts).

El respaldo contiene datos de la operación. Trátalo como información
confidencial y no lo compartas fuera del equipo autorizado.

## Configurar (una vez)

1. Supabase > **Connect** > **Session pooler** > copia la cadena
   `postgresql://postgres.xxxx:[TU-CONTRASEÑA]@aws-...pooler.supabase.com:5432/postgres`
   y pon la contraseña de la base (Settings > Database > Reset password si no la tienes).
2. GitHub > repositorio > Settings > Secrets and variables > Actions > New secret:
   - `SUPABASE_DB_URL` = la cadena del paso 1
   - `BACKUP_PASSPHRASE` = una frase larga. **Guárdala también fuera de GitHub**
     (papel, gestor de contraseñas): sin ella el respaldo no se puede abrir.
3. Actions > Respaldo diario > **Run workflow** para probarlo. Debe terminar en verde.

Si falla, GitHub te manda un correo.

## Restaurar

```bash
# 1. Descifrar (pide la frase)
openssl enc -d -aes-256-cbc -pbkdf2 -iter 200000 -in respaldo-AAAA-MM-DD.dump.enc -out respaldo.dump

# 2. Ver qué contiene
pg_restore --list respaldo.dump | head

# 3. Restaurar SOLO las tablas de la tienda en una instancia de Supabase de
#    OSYN POS (después de correr supabase/schema.sql y las migraciones)
pg_restore --data-only --schema=public --no-owner -d "CADENA_SESSION_POOLER_DE_LA_INSTANCIA" respaldo.dump
```

Restaurar `auth` (usuarios) a un proyecto nuevo es más delicado; lo más simple
es recrear los usuarios con `scripts/setup-usuarios.mjs`.
