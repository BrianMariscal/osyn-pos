import authenticate from "./_auth.js";
import rateLimit from "./_ratelimit.js";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Metodo no permitido" });
    return;
  }

  const auth = await authenticate(req);
  if (!auth.ok) {
    res.status(auth.status).json(auth.body);
    return;
  }
  if (!rateLimit(req)) {
    res.status(429).json({ error: "Demasiadas solicitudes, espera un momento" });
    return;
  }

  const provider = process.env.NVIDIA_API_KEY ? "nvidia" : "openai";
  const apiKey = provider === "nvidia" ? process.env.NVIDIA_API_KEY : process.env.OPENAI_API_KEY;
  if (!apiKey) {
    res.status(501).json({ error: "IA no configurada" });
    return;
  }

  try {
    const { text, products } = req.body || {};
    if (!Array.isArray(products) || typeof text !== "string") {
      res.status(400).json({ error: "Faltan texto o productos" });
      return;
    }
    const phrase = text.trim().slice(0, 2000);
    if (!phrase) {
      res.status(400).json({ error: "Texto vacio" });
      return;
    }

    const catalog = products.slice(0, 500).map((product) => ({
      id: String(product?.id || "").slice(0, 120),
      name: String(product?.name || "").slice(0, 200),
      category: String(product?.category || "").slice(0, 120),
      unit: String(product?.um || "Pza").slice(0, 10),
      stock: Number(product?.stock || 0) || 0
    })).filter((product) => product.id && product.name);

    const baseUrl = provider === "nvidia"
      ? (process.env.NVIDIA_BASE_URL || "https://integrate.api.nvidia.com/v1")
      : "https://api.openai.com/v1";
    const model = provider === "nvidia"
      ? (process.env.NVIDIA_MODEL || "nvidia/nemotron-3-ultra-550b-a55b")
      : (process.env.OPENAI_MODEL || "gpt-4o-mini");

    const response = await fetch(`${baseUrl.replace(/\/$/, "")}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model,
        temperature: 0,
        ...(provider === "openai" ? { response_format: { type: "json_object" } } : {}),
        messages: [
          {
            role: "system",
            content: "Eres un interprete de ventas para una tienda. Recibes una frase dictada y un catalogo. Devuelve exclusivamente JSON valido, sin markdown ni explicaciones, con esta forma: {\"items\":[{\"product_id\":\"id exacto del catalogo\",\"name\":\"nombre exacto del catalogo\",\"qty\":numero}],\"not_found\":[\"texto no encontrado\"]}. Debes incluir TODOS los productos mencionados en la frase, no solo el primero. Si el usuario dice 'dos coca, tres panes y una leche', deben salir 3 items. Usa solo productos existentes del catalogo. Copia product_id exactamente desde el campo id del catalogo. Si hay duda razonable, elige el producto mas parecido. No inventes ids. Convierte cantidades en espanol: medio=0.5, dos=2, etc. Ignora palabras como agrega, dame, pon, vende."
          },
          {
            role: "user",
            content: JSON.stringify({ text: phrase, catalog })
          }
        ]
      })
    });

    const body = await response.json();
    if (!response.ok) {
      res.status(response.status).json({ error: body.error?.message || "Error de IA" });
      return;
    }

    const content = body.choices?.[0]?.message?.content || "{}";
    const parsed = parseJsonContent(content);
    res.status(200).json({
      items: normalizeItems(parsed.items),
      not_found: Array.isArray(parsed.not_found) ? parsed.not_found : []
    });
  } catch (error) {
    res.status(500).json({ error: error.message || "Error interpretando venta" });
  }
};

function normalizeItems(items) {
  if (!Array.isArray(items)) return [];
  const out = [];
  for (const item of items) {
    if (!item || typeof item !== "object") continue;
    const product_id = String(item.product_id || item.id || "").slice(0, 120);
    const name = String(item.name || item.product_name || item.product || "").slice(0, 200);
    const qty = Number(item.qty ?? item.quantity ?? 1);
    if ((product_id || name) && Number.isFinite(qty) && qty > 0 && qty <= 1e6) {
      out.push({ product_id, name, qty });
    }
  }
  return out;
}

function parseJsonContent(content) {
  try {
    return JSON.parse(content);
  } catch {
    const match = String(content || "").match(/\{[\s\S]*\}/);
    return match ? JSON.parse(match[0]) : {};
  }
}
