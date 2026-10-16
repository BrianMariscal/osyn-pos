import { reportIssue } from "../core/monitoring";
import { SETTINGS_ROW_ID } from "../core/types";
import type { SyncTableKey } from "../core/types";
import type { SyncDeps } from "./sync-deps";
import { settingsProductRow } from "./sync-settings";
import { toSupabaseRow } from "./sync-tables";

/**
 * Errores de PostgREST causados por el contenido de una fila (restricción
 * check/FK/RLS, dato inválido). 401 (sesión) y 5xx (servidor) no lo son.
 */
function isRowRejection(status: number): boolean {
  return status === 400 || status === 403 || status === 409 || status === 422;
}

/** Sube los cambios pendientes; devuelve un aviso si la nube rechazó filas. */
export async function push(deps: SyncDeps, table: SyncTableKey, token: string): Promise<string | null> {
  const dirtyRaw = deps.tracker.takeIds(table);
  if (!dirtyRaw || !dirtyRaw.length) return null;
  // La fila de ajustes (nombre/logo/WhatsApp) solo la sube el dueño. Si quedó
  // pendiente en un dispositivo de admin/vendedor (por un guardado anterior),
  // se descarta para no repetir errores de RLS (42501).
  const isOwner = deps.auth.isOwner();
  const dirtyIds = isOwner ? dirtyRaw : dirtyRaw.filter((id) => id !== SETTINGS_ROW_ID);
  if (!dirtyIds.length) {
    deps.tracker.clear(table, dirtyRaw);
    return null;
  }
  let sourceRows: Array<Record<string, unknown>>;
  if (table === "products") {
    const rows = deps.repos.products.all() as unknown as Array<Record<string, unknown>>;
    sourceRows = dirtyIds.includes(SETTINGS_ROW_ID)
      ? [...rows, settingsProductRow(deps.store.getState().settings)]
      : rows;
  } else {
    sourceRows = deps.repos.repoFor(table).all() as unknown as Array<Record<string, unknown>>;
  }
  const rows = sourceRows
    .filter((row) => dirtyIds.includes(String(row.id)))
    .map((row) => toSupabaseRow(table, row));
  if (!rows.length) return null;
  const rejectedIds = new Set<string>();
  let firstError = "";
  // Las devoluciones se suben de una en una: el servidor topa cada cantidad
  // contra las devoluciones ya registradas de la venta, y dos devoluciones en
  // el mismo lote no se verían entre sí.
  const batches = table === "returns" ? rows.map((row) => [row]) : [rows];
  for (const batch of batches) {
    const res = await upsert(deps, table, token, batch);
    if (res.status === 404) {
      // Tabla sin migrar: los cambios quedan pendientes y se reintentan
      return null;
    }
    if (res.ok) continue;
    if (!isRowRejection(res.status)) throw new Error(`Error sincronizando ${table}: ${await res.text()}`);
    if (batch.length === 1) {
      rejectedIds.add(String(batch[0]!.id));
      if (!firstError) firstError = await res.text();
      continue;
    }
    // La base rechazó el lote (restricción o permiso): se sube fila por fila
    // para que una sola fila inválida no deje sin subir todas las demás.
    for (const row of batch) {
      const one = await upsert(deps, table, token, [row]);
      if (one.ok) continue;
      if (!isRowRejection(one.status)) throw new Error(`Error sincronizando ${table}: ${await one.text()}`);
      rejectedIds.add(String(row.id));
      if (!firstError) firstError = await one.text();
    }
  }
  // Las rechazadas siguen pendientes (no se pierden) y se reintentan en cada sync.
  deps.tracker.clear(table, dirtyIds.filter((id) => !rejectedIds.has(id)));
  deps.store.update((state) => {
    state.sync = { ...state.sync, pending: deps.tracker.pendingCount() };
  });
  if (!rejectedIds.size) return null;
  reportIssue(`Sync: la nube rechazó filas de ${table}`, { table, count: rejectedIds.size, error: firstError.slice(0, 500) });
  return `${rejectedIds.size} cambio(s) de ${table} rechazado(s) por la nube: ${firstError.slice(0, 200)}`;
}

function upsert(deps: SyncDeps, table: SyncTableKey, token: string, rows: Array<Record<string, unknown>>): Promise<Response> {
  return deps.client.rest(`${table}?on_conflict=id`, token, {
    method: "POST",
    headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
    body: JSON.stringify(rows)
  });
}
