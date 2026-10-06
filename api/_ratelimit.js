/**
 * Rate limit por IP: 20 requests por minuto por defecto.
 *
 * Con UPSTASH_REDIS_REST_URL y UPSTASH_REDIS_REST_TOKEN (plan gratuito de
 * Upstash) el conteo se comparte entre instancias y sobrevive a los deploys.
 * Sin ellas, o si Upstash no responde, se cuenta en memoria como antes.
 */
const hits = new Map(); // ip -> number[]

function clientIp(req) {
  const forwarded = req.headers["x-forwarded-for"] || "";
  return String(forwarded).split(",")[0].trim() || req.socket?.remoteAddress || "unknown";
}

function memoryLimit(ip, max, windowMs) {
  const now = Date.now();
  const list = (hits.get(ip) || []).filter((time) => now - time < windowMs);
  if (list.length >= max) {
    hits.set(ip, list);
    return false;
  }
  list.push(now);
  hits.set(ip, list);
  if (hits.size > 5000) {
    for (const [key, times] of hits) {
      if (!times.length) hits.delete(key);
    }
  }
  return true;
}

/** Ventana fija en Redis: INCR + EXPIRE en una sola ida. null = no disponible. */
async function redisLimit(ip, max, windowMs) {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return null;
  const windowSec = Math.max(1, Math.round(windowMs / 1000));
  const key = `rl:${ip}:${Math.floor(Date.now() / windowMs)}`;
  try {
    const res = await fetch(`${String(url).replace(/\/$/, "")}/pipeline`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify([["INCR", key], ["EXPIRE", key, windowSec]]),
      signal: AbortSignal.timeout(1500)
    });
    if (!res.ok) return null;
    const [incr] = await res.json();
    const count = Number(incr?.result);
    return Number.isFinite(count) ? count <= max : null;
  } catch {
    return null;
  }
}

export default async function rateLimit(req, max = 20, windowMs = 60000) {
  const ip = clientIp(req);
  const shared = await redisLimit(ip, max, windowMs);
  return shared ?? memoryLimit(ip, max, windowMs);
}
