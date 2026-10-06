/**
 * Voz del asistente con ElevenLabs (Texto a voz).
 *   GET  /api/tts            → lista las voces disponibles en tu biblioteca.
 *   POST /api/tts            → genera audio desde { voice_id, text }.
 * Requiere sesión válida y la variable de entorno ELEVENLABS_API_KEY.
 */
import authenticate from "./_auth.js";
import rateLimit from "./_ratelimit.js";

const EL_BASE = "https://api.elevenlabs.io/v1";

export default async function handler(req, res) {
  if (!["GET", "POST"].includes(req.method)) {
    res.status(405).json({ error: "Metodo no permitido" });
    return;
  }
  const auth = await authenticate(req);
  if (!auth.ok) {
    res.status(auth.status).json(auth.body);
    return;
  }
  if (!rateLimit(req, 40)) {
    res.status(429).json({ error: "Demasiadas solicitudes" });
    return;
  }
  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey) {
    res.status(501).json({ error: "TTS no configurado (falta ELEVENLABS_API_KEY)" });
    return;
  }
  const elHeaders = { "xi-api-key": apiKey, "Content-Type": "application/json" };

  try {
    if (req.method === "GET") {
      const list = await fetch(`${EL_BASE}/voices`, { headers: elHeaders });
      if (!list.ok) {
        res.status(502).json({ error: "No se pudieron leer las voces de ElevenLabs" });
        return;
      }
      const body = await list.json();
      const voices = (body.voices || [])
        .map((voice) => ({
          voice_id: String(voice.voice_id || ""),
          name: String(voice.name || "Voz"),
          language: String(voice.labels?.accent || voice.labels?.language || "")
        }))
        .filter((voice) => voice.voice_id);
      res.status(200).json({ voices });
      return;
    }

    const { voice_id, text } = req.body || {};
    const phrase = typeof text === "string" ? text.trim().slice(0, 500) : "";
    const vid = typeof voice_id === "string" ? voice_id.trim().slice(0, 120) : "";
    if (!phrase || !vid) {
      res.status(400).json({ error: "Falta texto o voice_id" });
      return;
    }
    // Flash v2.5: el modelo de menor latencia de ElevenLabs (habla español);
    // audio ligero para que llegue y suene más rápido.
    const tts = await fetch(`${EL_BASE}/text-to-speech/${encodeURIComponent(vid)}/stream?output_format=mp3_22050_32&optimize_streaming_latency=3`, {
      method: "POST",
      headers: elHeaders,
      body: JSON.stringify({
        text: phrase,
        model_id: "eleven_flash_v2_5",
        voice_settings: { stability: 0.5, similarity_boost: 0.75 }
      })
    });
    if (!tts.ok) {
      const detail = await tts.text();
      res.status(502).json({ error: `ElevenLabs: ${detail.slice(0, 200)}` });
      return;
    }
    // Se reenvía el audio conforme llega (sin esperar el archivo completo)
    res.status(200);
    res.setHeader("Content-Type", "audio/mpeg");
    res.setHeader("Cache-Control", "no-store");
    for await (const chunk of tts.body) res.write(chunk);
    res.end();
  } catch (error) {
    res.status(500).json({ error: error.message || "Error generando voz" });
  }
}
