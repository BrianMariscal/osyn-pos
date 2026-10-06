/**
 * Gestión de usuarios por rol:
 *   - DUEÑO: crea/edita/elimina a cualquier persona (dueños, admins, vendedores).
 *   - ADMINISTRADOR: solo crea/edita/elimina VENDEDORES; no puede tocar
 *     perfiles de otros admins ni del dueño, ni cambiar su propio perfil.
 * La clave service_role vive SOLO en el servidor.
 *
 * Env var requerida en Vercel: SUPABASE_SERVICE_ROLE_KEY
 */
import authenticate from "./_auth.js";
import rateLimit from "./_ratelimit.js";

export default async function handler(req, res) {
  if (!["GET", "POST", "PATCH", "DELETE"].includes(req.method)) {
    res.status(405).json({ error: "Metodo no permitido" });
    return;
  }

  const auth = await authenticate(req);
  if (!auth.ok) {
    res.status(auth.status).json(auth.body);
    return;
  }
  if (!rateLimit(req, 30)) {
    res.status(429).json({ error: "Demasiadas solicitudes" });
    return;
  }

  const base = (process.env.SUPABASE_URL || "").replace(/\/$/, "");
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!base || !service) {
    res.status(500).json({ error: "Servidor sin SUPABASE_SERVICE_ROLE_KEY configurada" });
    return;
  }
  const serviceHeaders = { apikey: service, Authorization: `Bearer ${service}`, "Content-Type": "application/json" };

  try {
    const caller = await fetchProfile(base, serviceHeaders, auth.user.id);
    const role = caller ? caller.role : null;
    if (!role || (role !== "dueno" && role !== "admin")) {
      res.status(403).json({ error: "Solo el dueño o un administrador gestiona usuarios" });
      return;
    }
    const isOwner = role === "dueno";
    // Administrador asignado a una sucursal: solo gestiona vendedores de ESA sucursal.
    const callerBranch = !isOwner && caller.branch_id ? String(caller.branch_id) : null;

    if (req.method === "GET") return await listUsers(res, base, serviceHeaders, isOwner, callerBranch);
    if (req.method === "POST") return await createUser(res, base, serviceHeaders, isOwner, callerBranch, req.body || {});
    if (req.method === "PATCH") return await updateUser(res, base, serviceHeaders, isOwner, callerBranch, auth, req.body || {});
    if (req.method === "DELETE") return await deleteUser(res, base, serviceHeaders, isOwner, callerBranch, auth, req.body || {});
  } catch (error) {
    res.status(500).json({ error: error.message || "Error gestionando usuarios" });
  }
};

async function fetchProfile(base, headers, userId) {
  const res = await fetch(`${base}/rest/v1/profiles?user_id=eq.${encodeURIComponent(userId)}&select=role,branch_id`, { headers });
  if (!res.ok) return null;
  const row = (await res.json())[0];
  return row ? { role: row.role, branch_id: row.branch_id ?? null } : null;
}

async function fetchProfileRole(base, headers, userId) {
  const profile = await fetchProfile(base, headers, userId);
  return profile ? profile.role : null;
}

/** Un admin de sucursal solo toca vendedores de su sucursal. */
async function outsideCallerBranch(base, headers, callerBranch, userId) {
  if (!callerBranch) return false;
  const target = await fetchProfile(base, headers, userId);
  return !target || target.branch_id !== callerBranch;
}

function normalizeRole(role, isOwner) {
  if (role === "dueno" || role === "admin" || role === "empleado") {
    return isOwner ? role : "empleado";
  }
  return "empleado";
}

async function listUsers(res, base, serviceHeaders, isOwner, callerBranch) {
  const authRes = await fetch(`${base}/auth/v1/admin/users?per_page=200`, { headers: serviceHeaders });
  if (!authRes.ok) {
    res.status(502).json({ error: "No se pudieron leer los usuarios" });
    return;
  }
  const body = await authRes.json();
  const authUsers = body.users || [];
  const profilesRes = await fetch(`${base}/rest/v1/profiles?select=user_id,name,role,branch_id`, { headers: serviceHeaders });
  const profiles = profilesRes.ok ? await profilesRes.json() : [];
  const byId = new Map(profiles.map((p) => [p.user_id, p]));
  let users = authUsers
    .filter((user) => !user.deleted_at)
    .map((user) => ({
      user_id: user.id,
      email: user.email || "",
      name: (byId.get(user.id) || {}).name || user.user_metadata?.name || user.email || "",
      role: (byId.get(user.id) || {}).role || "empleado",
      branch_id: (byId.get(user.id) || {}).branch_id ?? null,
      created_at: user.created_at
    }));
  // El administrador solo ve y administra vendedores.
  if (!isOwner) users = users.filter((user) => user.role === "empleado");
  if (callerBranch) users = users.filter((user) => user.branch_id === callerBranch);
  users.sort((a, b) => a.name.localeCompare(b.name));
  res.status(200).json({ users });
}

async function createUser(res, base, serviceHeaders, isOwner, callerBranch, body) {
  const { email, password, name, role, branch_id } = body || {};
  if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(String(email))) {
    res.status(400).json({ error: "Correo invalido" });
    return;
  }
  if (!password || String(password).length < 6) {
    res.status(400).json({ error: "La contrasena necesita al menos 6 caracteres" });
    return;
  }
  const normalizedRole = normalizeRole(role, isOwner);
  const safeName = typeof name === "string" ? name.trim().slice(0, 80) : "";
  const safeBranch = callerBranch || (branch_id === null || branch_id === undefined ? null : String(branch_id).slice(0, 80) || null);

  const createRes = await fetch(`${base}/auth/v1/admin/users`, {
    method: "POST",
    headers: serviceHeaders,
    body: JSON.stringify({ email, password, email_confirm: true, user_metadata: { name: safeName || email } })
  });
  if (!createRes.ok) {
    const errorBody = await createRes.json().catch(() => ({}));
    res.status(createRes.status === 422 ? 409 : 502).json({ error: errorBody.msg || errorBody.error_description || "No se pudo crear el usuario" });
    return;
  }
  const user = await createRes.json();
  await upsertProfile(base, serviceHeaders, { user_id: user.id, name: safeName || email, role: normalizedRole, branch_id: safeBranch });
  res.status(200).json({ ok: true, user_id: user.id });
}

async function updateUser(res, base, serviceHeaders, isOwner, callerBranch, auth, body) {
  const { user_id, name, role, branch_id, password } = body || {};
  if (!user_id || typeof user_id !== "string") {
    res.status(400).json({ error: "Falta user_id" });
    return;
  }
  if (!isOwner) {
    if (user_id === auth.user.id) {
      res.status(403).json({ error: "No puedes editar tu propio perfil de administrador" });
      return;
    }
    const targetRole = await fetchProfileRole(base, serviceHeaders, user_id);
    if (targetRole !== "empleado") {
      res.status(403).json({ error: "Un administrador solo puede editar vendedores" });
      return;
    }
    if (await outsideCallerBranch(base, serviceHeaders, callerBranch, user_id)) {
      res.status(403).json({ error: "Ese vendedor es de otra sucursal" });
      return;
    }
  }
  if (password && String(password).length < 6) {
    res.status(400).json({ error: "La contrasena necesita al menos 6 caracteres" });
    return;
  }
  if (password) {
    const putRes = await fetch(`${base}/auth/v1/admin/users/${encodeURIComponent(user_id)}`, {
      method: "PUT",
      headers: serviceHeaders,
      body: JSON.stringify({ password })
    });
    if (!putRes.ok) {
      res.status(502).json({ error: "No se pudo actualizar la contrasena" });
      return;
    }
  }
  const patch = {};
  if (typeof name === "string") patch.name = name.trim().slice(0, 80);
  if (role !== undefined) patch.role = normalizeRole(role, isOwner);
  if (callerBranch) patch.branch_id = callerBranch;
  else if (branch_id !== undefined) patch.branch_id = branch_id === null || branch_id === undefined ? null : String(branch_id).slice(0, 80) || null;
  if (Object.keys(patch).length) {
    patch.updated_at = new Date().toISOString();
    const profileRes = await fetch(`${base}/rest/v1/profiles?user_id=eq.${encodeURIComponent(user_id)}`, {
      method: "PATCH",
      headers: serviceHeaders,
      body: JSON.stringify(patch)
    });
    if (!profileRes.ok) {
      res.status(502).json({ error: "No se pudo actualizar el perfil" });
      return;
    }
  }
  res.status(200).json({ ok: true });
}

async function deleteUser(res, base, serviceHeaders, isOwner, callerBranch, auth, body) {
  const { user_id } = body || {};
  if (!user_id || typeof user_id !== "string") {
    res.status(400).json({ error: "Falta user_id" });
    return;
  }
  if (user_id === auth.user.id) {
    res.status(400).json({ error: "No puedes eliminar tu propia sesion" });
    return;
  }
  if (!isOwner) {
    const targetRole = await fetchProfileRole(base, serviceHeaders, user_id);
    if (targetRole !== "empleado") {
      res.status(403).json({ error: "Un administrador solo puede eliminar vendedores" });
      return;
    }
    if (await outsideCallerBranch(base, serviceHeaders, callerBranch, user_id)) {
      res.status(403).json({ error: "Ese vendedor es de otra sucursal" });
      return;
    }
  }
  const delRes = await fetch(`${base}/auth/v1/admin/users/${encodeURIComponent(user_id)}`, {
    method: "DELETE",
    headers: serviceHeaders
  });
  if (!delRes.ok) {
    res.status(502).json({ error: "No se pudo eliminar el usuario" });
    return;
  }
  res.status(200).json({ ok: true });
}

async function upsertProfile(base, serviceHeaders, row) {
  await fetch(`${base}/rest/v1/profiles?on_conflict=user_id`, {
    method: "POST",
    headers: { ...serviceHeaders, Prefer: "resolution=merge-duplicates" },
    body: JSON.stringify([row])
  });
}
