/**
 * Verifica el JWT de Supabase del request contra /auth/v1/user.
 * Sin sesión válida los endpoints de IA devuelven 401.
 *
 * Variables de entorno requeridas en Vercel:
 *   SUPABASE_URL        (https://xxx.supabase.co)
 *   SUPABASE_ANON_KEY   (anon / publishable key)
 *   NVIDIA_API_KEY | OPENAI_API_KEY
 */
const tokenCache = new Map(); // token -> { ok: boolean, expires: number }
const CACHE_TTL_MS = 60 * 1000;

export default async function authenticate(req) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  if (!token) {
    return { ok: false, status: 401, body: { error: "Sesion requerida" } };
  }

  const cached = tokenCache.get(token);
  const now = Date.now();
  if (cached && cached.expires > now) {
    return cached.ok ? { ok: true, user: cached.user } : { ok: false, status: 401, body: { error: "Sesion invalida o expirada" } };
  }

  const base = process.env.SUPABASE_URL;
  const anon = process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_KEY;
  if (!base || !anon) {
    return { ok: false, status: 500, body: { error: "Servidor sin configuracion de Supabase" } };
  }

  try {
    const res = await fetch(`${String(base).replace(/\/$/, "")}/auth/v1/user`, {
      headers: { Authorization: `Bearer ${token}`, apikey: anon }
    });
    if (!res.ok) {
      tokenCache.set(token, { ok: false, expires: now + CACHE_TTL_MS });
      return { ok: false, status: 401, body: { error: "Sesion invalida o expirada" } };
    }
    const user = await res.json();
    tokenCache.set(token, { ok: true, user, expires: now + CACHE_TTL_MS });
    if (tokenCache.size > 1000) {
      for (const [key, value] of tokenCache) {
        if (value.expires <= now) tokenCache.delete(key);
      }
    }
    return { ok: true, user };
  } catch {
    return { ok: false, status: 502, body: { error: "No se pudo validar la sesion" } };
  }
}
