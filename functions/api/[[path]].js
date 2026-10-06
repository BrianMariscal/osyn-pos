/**
 * Cloudflare Pages Functions: atiende /api/* con los mismos handlers de api/
 * (escritos con la forma req/res de Vercel/Node). Este adaptador traduce
 * Request → req y res → Response, así api/*.js no cambia y sigue sirviendo
 * en Vercel o en `vercel dev`.
 */
import parseSale from "../../api/parse-sale.js";
import posAssistant from "../../api/pos-assistant.js";
import tts from "../../api/tts.js";
import users from "../../api/users.js";

const ROUTES = {
  "parse-sale": parseSale,
  "pos-assistant": posAssistant,
  tts,
  users
};

/** Variables de Cloudflare (secrets/vars) → process.env, como en Vercel. */
function exposeEnv(env) {
  globalThis.process ??= { env: {} };
  process.env ??= {};
  for (const [key, value] of Object.entries(env || {})) {
    if (typeof value === "string") process.env[key] = value;
  }
}

async function toNodeRequest(request) {
  const headers = {};
  request.headers.forEach((value, key) => {
    headers[key.toLowerCase()] = value;
  });
  // La IP real del cliente la pone Cloudflare (rate limit por IP).
  const ip = request.headers.get("cf-connecting-ip");
  if (ip) headers["x-forwarded-for"] = ip;
  let body;
  if (!["GET", "HEAD"].includes(request.method)) {
    const text = await request.text();
    if (text && (headers["content-type"] || "").includes("application/json")) {
      try {
        body = JSON.parse(text);
      } catch {
        body = undefined;
      }
    } else {
      body = text || undefined;
    }
  }
  return { method: request.method, headers, body, url: new URL(request.url).pathname, socket: { remoteAddress: ip || "" } };
}

/** res estilo Node: status/json/setHeader para respuestas normales; write/end para streaming. */
function createResponse() {
  let status = 200;
  const headers = new Headers();
  let stream = null;
  let writer = null;
  let settle;
  const ready = new Promise((resolve) => {
    settle = resolve;
  });
  const startStream = () => {
    if (!stream) {
      stream = new TransformStream();
      writer = stream.writable.getWriter();
      settle(new Response(stream.readable, { status, headers }));
    }
  };
  const res = {
    status(code) {
      status = code;
      return res;
    },
    setHeader(name, value) {
      headers.set(name, String(value));
      return res;
    },
    json(data) {
      headers.set("Content-Type", "application/json; charset=utf-8");
      settle(new Response(JSON.stringify(data), { status, headers }));
      return res;
    },
    send(data) {
      settle(new Response(data, { status, headers }));
      return res;
    },
    write(chunk) {
      startStream();
      void writer.write(typeof chunk === "string" ? new TextEncoder().encode(chunk) : chunk);
      return true;
    },
    end(chunk) {
      if (chunk !== undefined) res.write(chunk);
      if (writer) void writer.close();
      else settle(new Response(null, { status, headers }));
      return res;
    }
  };
  return { res, ready };
}

export async function onRequest(context) {
  const name = String(context.params.path?.[0] || "");
  const handler = Object.hasOwn(ROUTES, name) ? ROUTES[name] : null;
  if (!handler || (context.params.path?.length ?? 0) !== 1) {
    return Response.json({ error: "No encontrado" }, { status: 404 });
  }
  exposeEnv(context.env);
  const req = await toNodeRequest(context.request);
  const { res, ready } = createResponse();
  const done = Promise.resolve(handler(req, res)).catch((error) => {
    res.status(500).json({ error: error?.message || "Error interno" });
  });
  // Si el handler terminó sin responder, se contesta vacío para no colgar.
  const fallback = done.then(() => new Response(null, { status: 204 }));
  const response = await Promise.race([ready, fallback]);
  context.waitUntil(done);
  return response;
}
