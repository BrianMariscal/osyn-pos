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
  if (!await rateLimit(req)) {
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
    const { text, context } = req.body || {};
    if (typeof text !== "string" || !context || typeof context !== "object") {
      res.status(400).json({ error: "Falta texto o contexto" });
      return;
    }
    const phrase = text.trim().slice(0, 2000);
    if (!phrase) {
      res.status(400).json({ error: "Texto vacio" });
      return;
    }
    const serializedContext = JSON.stringify(context);
    if (serializedContext.length > 180000) {
      res.status(413).json({ error: "Contexto demasiado grande" });
      return;
    }

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
             content: "Eres el asistente de un punto de venta. Devuelve exclusivamente JSON valido, sin markdown. Acciones permitidas: add_sale_items, register_expense, register_purchase, go_to_tab, open_report, prepare_shift_close, credit_charge, low_stock, unknown. Esquemas: {\"action\":\"add_sale_items\",\"items\":[{\"product_id\":\"id exacto\",\"name\":\"nombre exacto\",\"qty\":numero}],\"message\":\"texto corto\"}; {\"action\":\"register_purchase\",\"supplier_id\":\"id exacto\",\"supplier_name\":\"nombre exacto\",\"purchase_items\":[{\"product_id\":\"id exacto\",\"name\":\"nombre exacto\",\"qty\":numero,\"packages\":numero,\"units_per_package\":numero,\"total_paid\":numero}],\"message\":\"texto corto\"}. En compras, si dicen cajas, usa packages=cajas y units_per_package=piezas por caja; por ejemplo 2 cajas con 12 piezas se convierte en 24 unidades. Si el costo es por linea, usa total_paid para esa linea. Para ventas incluye TODOS los productos mencionados. Usa solo ids del catalogo, proveedores o clientes del contexto. Si no estas seguro usa unknown. No cierres corte, no cobres venta, no borres datos. No inventes sucursales ni consolidados: usa solo el contexto. Si hay una sola sucursal, no la menciones."
          },
           {
             role: "user",
             content: JSON.stringify({ text: phrase, context })
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
    res.status(200).json(normalizeAction(parseJsonContent(content)));
  } catch (error) {
    res.status(500).json({ error: error.message || "Error interpretando instruccion" });
  }
};

function normalizeAction(action) {
  if (!action || typeof action !== "object") return { action: "unknown", message: "No entendi la instruccion" };
  if (!action.action) action.action = "unknown";
  if (Array.isArray(action.items)) {
    const out = [];
    for (const item of action.items) {
      if (!item || typeof item !== "object") continue;
      const product_id = String(item.product_id || item.id || "").slice(0, 120);
      const name = String(item.name || item.product_name || item.product || "").slice(0, 200);
      const qty = Number(item.qty ?? item.quantity ?? 1);
      if ((product_id || name) && Number.isFinite(qty) && qty > 0 && qty <= 1e6) {
        out.push({ product_id, name, qty });
      }
    }
    action.items = out;
  }
  if (Array.isArray(action.purchase_items)) {
    action.purchase_items = action.purchase_items
      .filter((item) => item && typeof item === "object")
      .map((item) => ({
        product_id: String(item.product_id || item.id || "").slice(0, 120),
        name: String(item.name || item.product_name || item.product || "").slice(0, 200),
        qty: Number(item.qty ?? item.quantity ?? 0),
        packages: Number(item.packages ?? item.cases ?? 0),
        units_per_package: Number(item.units_per_package ?? item.pieces_per_case ?? 0),
        total_paid: Number(item.total_paid ?? item.total ?? item.amount ?? 0)
      }))
        .filter((item) => (item.product_id || item.name) && Number.isFinite(item.total_paid) && item.total_paid >= 0);
  }
  return action;
}

function parseJsonContent(content) {
  try {
    return JSON.parse(content);
  } catch {
    const match = String(content || "").match(/\{[\s\S]*\}/);
    return match ? JSON.parse(match[0]) : {};
  }
}
