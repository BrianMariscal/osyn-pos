#!/usr/bin/env node
/**
 * Configuración inicial de usuarios para Abarrotes POS (proyecto Supabase NUEVO).
 *
 * Qué hace:
 *   1. Valida que el schema ya esté aplicado (tabla profiles).
 *   2. Crea (o actualiza) al DUEÑO, al ADMINISTRADOR y al VENDEDOR,
 *      con correo confirmado para entrar de inmediato.
 *   3. Asigna perfiles: dueño y administrador ven toda la tienda; el vendedor
 *      queda atado a una sucursal (por defecto sucursal-1).
 *   4. Si pasas --anon, reescribe public/config.js con la URL y clave pública.
 *
 * Uso (Node 18+):
 *   node scripts/setup-usuarios.mjs --url https://TU-PROYECTO.supabase.co --service-role TU_SERVICE_ROLE_KEY --anon TU_ANON_KEY
 *
 * Opcionales (si omites alguno no se crea / se conserva lo existente):
 *   --dueno-email dueño@tienda.com     --dueno-password Clave1
 *   --admin-email admin@tienda.com     --admin-password Clave2
 *   --vendedor-email vendedor@tienda.com --vendedor-password Clave3
 *   --sucursal sucursal-1              (sucursal del vendedor)
 *
 * La service_role key es SECRETA: solo úsala aquí y nunca la subas a git.
 */

const args = {};
for (let i = 2; i < process.argv.length; i += 2) {
  const key = (process.argv[i] ?? "").replace(/^--/, "");
  args[key] = process.argv[i + 1] ?? "";
}

const url = (args.url || process.env.SUPABASE_URL || "").replace(/\/$/, "");
const serviceRole = args["service-role"] || process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const anon = args.anon || process.env.SUPABASE_ANON_KEY || "";
const sucursalVendedor = args.sucursal || "sucursal-1";

if (!url || !serviceRole) {
  console.error("Faltan datos. Ejemplo:\n  node scripts/setup-usuarios.mjs --url https://xxx.supabase.co --service-role eyJ... --anon sb_publishable_...");
  process.exit(1);
}

const accounts = [
  {
    role: "dueno",
    name: "Dueño",
    email: args["dueno-email"],
    password: args["dueno-password"],
    branch_id: null
  },
  {
    role: "admin",
    name: "Administrador",
    email: args["admin-email"],
    password: args["admin-password"],
    branch_id: null
  },
  {
    role: "empleado",
    name: "Vendedor",
    email: args["vendedor-email"],
    password: args["vendedor-password"],
    branch_id: sucursalVendedor
  }
].filter((account) => account.email && account.password);

if (!accounts.length) {
  console.error("Pasa al menos un par correo/contraseña (--dueno-email/--dueno-password, --admin-email/--admin-password o --vendedor-email/--vendedor-password).");
  process.exit(1);
}

const adminHeaders = {
  apikey: serviceRole,
  Authorization: `Bearer ${serviceRole}`,
  "Content-Type": "application/json"
};

async function main() {
  // 1. Validar schema aplicado
  const probe = await fetch(`${url}/rest/v1/profiles?select=user_id&limit=1`, { headers: adminHeaders });
  if (!probe.ok) {
    const body = await probe.text();
    console.error(`No pude leer la tabla profiles (${probe.status}): ${body}`);
    console.error("Ejecuta primero supabase-schema.sql en Supabase > SQL Editor.");
    process.exit(1);
  }

  // 2. Crear o actualizar usuarios y perfiles
  const rows = [];
  for (const account of accounts) {
    const user = await upsertUser(account.email, account.password, account.name);
    rows.push({ user_id: user.id, name: account.name, role: account.role, branch_id: account.branch_id });
  }
  await upsertProfiles(rows);

  // 3. config.js para la app
  if (anon) {
    const config = `window.POS_CONFIG = {\n  supabaseUrl: "${url}",\n  supabaseKey: "${anon}"\n};\n`;
    const { writeFileSync } = await import("node:fs");
    writeFileSync(new URL("../public/config.js", import.meta.url), config);
    console.log("public/config.js actualizado con la nueva cuenta.");
  } else {
    console.log("Sin --anon: actualiza manualmente public/config.js con la URL y anon key.");
  }

  console.log("\n================ LISTO ================");
  for (const account of accounts) {
    console.log(`${account.name} : ${account.email} / ${account.password} (rol ${account.role}${account.branch_id ? `, ${account.branch_id}` : ", todas las sucursales"})`);
  }
  console.log("Cambia estas contraseñas desde Supabase > Authentication > Users cuando quieras.");
}

async function upsertUser(email, password, name) {
  const create = await fetch(`${url}/auth/v1/admin/users`, {
    method: "POST",
    headers: adminHeaders,
    body: JSON.stringify({ email, password, email_confirm: true, user_metadata: { name } })
  });
  if (create.ok) {
    const user = await create.json();
    console.log(`Usuario creado: ${email}`);
    return user;
  }
  if (create.status === 422) {
    const existing = await findUserByEmail(email);
    if (!existing) throw new Error(`El usuario ${email} ya existe pero no lo encontré en la lista`);
    const update = await fetch(`${url}/auth/v1/admin/users/${existing.id}`, {
      method: "PUT",
      headers: adminHeaders,
      body: JSON.stringify({ password, email_confirm: true, user_metadata: { name } })
    });
    if (!update.ok) throw new Error(`No pude actualizar ${email}: ${await update.text()}`);
    console.log(`Usuario existente actualizado (nueva contraseña): ${email}`);
    return existing;
  }
  throw new Error(`No pude crear ${email}: ${await create.text()}`);
}

async function findUserByEmail(email) {
  for (let page = 1; page <= 5; page += 1) {
    const res = await fetch(`${url}/auth/v1/admin/users?per_page=50&page=${page}`, { headers: adminHeaders });
    if (!res.ok) break;
    const body = await res.json();
    const users = body.users ?? [];
    const found = users.find((user) => user.email?.toLowerCase() === email.toLowerCase());
    if (found) return found;
    if (users.length < 50) break;
  }
  return null;
}

async function upsertProfiles(rows) {
  const res = await fetch(`${url}/rest/v1/profiles?on_conflict=user_id`, {
    method: "POST",
    headers: { ...adminHeaders, Prefer: "resolution=merge-duplicates" },
    body: JSON.stringify(rows)
  });
  if (!res.ok) throw new Error(`No pude asignar perfiles: ${await res.text()}`);
  console.log("Perfiles asignados.");
}

main().catch((error) => {
  console.error(String(error.message || error));
  process.exit(1);
});
