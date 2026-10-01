/**
 * Rate limit en memoria por IP: 20 requests por minuto por defecto.
 * Suficiente para un endpoint de IA por tienda; reinicia en cada deploy.
 */
const hits = new Map(); // ip -> number[]

export default function rateLimit(req, max = 20, windowMs = 60000) {
  const forwarded = req.headers["x-forwarded-for"] || "";
  const ip = String(forwarded).split(",")[0].trim() || req.socket?.remoteAddress || "unknown";
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
