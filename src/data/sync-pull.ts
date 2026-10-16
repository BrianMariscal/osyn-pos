import { nowISO } from "../core/dates";
import { SETTINGS_ROW_ID } from "../core/types";
import type { SyncTableKey } from "../core/types";
import { toast } from "../ui/components/toast";
import type { BaseRow } from "./repositories";
import type { SyncDeps } from "./sync-deps";
import { sanitizeCloudSettings } from "./sync-settings";
import { fromSupabaseRow, pullSince } from "./sync-tables";

/** PostgREST devuelve como máximo 1000 filas por petición (max-rows). */
const PULL_PAGE_SIZE = 1000;
/**
 * synced_at se fija al escribir la fila, pero es visible hasta el commit; se
 * relee un margen hacia atrás para no saltar escrituras que confirmaron tarde.
 * Releer es seguro: el merge es idempotente.
 */
const SYNC_CURSOR_OVERLAP_MS = 60_000;

/** null = la tabla aún no tiene synced_at (migración pendiente). */
type PullPage = { rows: Array<Record<string, unknown>>; cursor?: string; capturedAt?: string } | null;

/** synced_at si la tabla ya lo tiene; si no (migración pendiente), updated_at. */
export async function fetchTable(deps: SyncDeps, table: SyncTableKey, token: string): Promise<PullPage> {
  return (await fetchBySyncedAt(deps, table, token)) ?? (await fetchByUpdatedAt(deps, table, token));
}

/**
 * Lectura incremental por synced_at, que pone el servidor al recibir cada
 * fila. A diferencia de updated_at (reloj del dispositivo, momento de la
 * edición), no pierde filas subidas tarde ni con relojes desfasados.
 * Sin cursor previo se lee la tabla completa, lo que también recupera las
 * filas que la lectura por updated_at se saltó antes.
 */
async function fetchBySyncedAt(deps: SyncDeps, table: SyncTableKey, token: string): Promise<PullPage> {
  const cursor = deps.store.getState().sync.syncCursors[table];
  const since = cursor ? new Date(Date.parse(cursor) - SYNC_CURSOR_OVERLAP_MS).toISOString() : null;
  const rows: Array<Record<string, unknown>> = [];
  let maxSyncedAt = cursor;
  for (let offset = 0; ; offset += PULL_PAGE_SIZE) {
    const params = new URLSearchParams({
      select: "*",
      order: "synced_at.asc,id.asc",
      limit: String(PULL_PAGE_SIZE),
      offset: String(offset)
    });
    if (since) params.set("synced_at", `gte.${since}`);
    const res = await deps.client.rest(`${table}?${params.toString()}`, token);
    if (res.status === 404) return null;
    if (!res.ok) {
      const body = await res.text();
      if (res.status === 400 && body.includes("synced_at")) return null;
      throw new Error(`Error leyendo ${table}: ${body}`);
    }
    const batch = (await res.json()) as Array<Record<string, unknown>>;
    for (const row of batch) {
      const syncedAt = typeof row.synced_at === "string" ? row.synced_at : "";
      if (syncedAt && (!maxSyncedAt || Date.parse(syncedAt) > Date.parse(maxSyncedAt))) maxSyncedAt = syncedAt;
      rows.push(row);
    }
    if (batch.length < PULL_PAGE_SIZE) break;
  }
  return { rows, cursor: maxSyncedAt };
}

/** Lectura anterior por updated_at, mientras falte la migración synced_at. */
async function fetchByUpdatedAt(deps: SyncDeps, table: SyncTableKey, token: string): Promise<PullPage> {
  const since = deps.store.getState().sync.lastPulledAt[table];
  const capturedAt = nowISO();
  const params = new URLSearchParams({ select: "*" });
  if (since) {
    // Margen de PULL_OVERLAP_MS: updated_at lo escribe el reloj del
    // dispositivo que hizo el cambio. Si ese reloj va atrasado respecto al
    // de este dispositivo, sin margen el cambio quedaba fuera para siempre
    // (o hasta que alguien volviera a tocar la fila). Releer el borde es
    // seguro: el merge es idempotente (last-write-wins por updated_at).
    params.set("updated_at", `gte.${pullSince(since)}`);
    params.set("order", "updated_at.asc");
  }
  const res = await deps.client.rest(`${table}?${params.toString()}`, token);
  if (res.status === 404) {
    // Tabla sin migrar todavía en Supabase: se salta sin romper la sync
    return null;
  }
  if (!res.ok) throw new Error(`Error leyendo ${table}: ${await res.text()}`);
  return { rows: (await res.json()) as Array<Record<string, unknown>>, capturedAt };
}

export function applyPulled(deps: SyncDeps, table: SyncTableKey, page: NonNullable<PullPage>): string[] {
  let mapped = page.rows.map(fromSupabaseRow);
  if (table === "products") {
    mapped = applySettingsRow(deps, mapped);
  }
  const conflicts = deps.repos.repoFor(table).mergeFromCloud(mapped as unknown as BaseRow[]);
  deps.store.update((state) => {
    state.sync = {
      ...state.sync,
      lastPulledAt: page.capturedAt ? { ...state.sync.lastPulledAt, [table]: page.capturedAt } : state.sync.lastPulledAt,
      syncCursors: page.cursor ? { ...state.sync.syncCursors, [table]: page.cursor } : state.sync.syncCursors
    };
  });
  return conflicts;
}

/**
 * La mayoría de los conflictos de contadores (stock/balance) se resuelven
 * solos en el merge (delta local aplicado sobre la nube). Aquí solo llegan
 * los que la app no pudo rebasar: la nube borró una fila que tenía un cambio
 * local sin subir, y ese cambio se descartó. Se avisa para revisión.
 */
export function warnConflicts(deps: SyncDeps, conflicts: Array<{ table: SyncTableKey; id: string }>): void {
  const stockNames: string[] = [];
  const customerNames: string[] = [];
  for (const { table, id } of conflicts) {
    if (table === "product_stocks") {
      const productId = id.slice(0, id.lastIndexOf(":"));
      const name = deps.repos.products.byId(productId)?.name;
      if (name) stockNames.push(name);
    } else if (table === "customers") {
      const name = deps.repos.customers.byId(id)?.name;
      if (name) customerNames.push(name);
    }
    console.warn(`[sync] cambio local descartado en ${table} → ${id}`);
  }
  const uniqueStock = [...new Set(stockNames)];
  const uniqueCustomers = [...new Set(customerNames)];
  if (uniqueStock.length) {
    const first = uniqueStock.slice(0, 3).join(", ");
    const rest = uniqueStock.length > 3 ? ` y ${uniqueStock.length - 3} más` : "";
    toast(`Se descartó un cambio de inventario en ${first}${rest} (se borró desde otro dispositivo)`);
  }
  if (uniqueCustomers.length) {
    const first = uniqueCustomers.slice(0, 3).join(", ");
    const rest = uniqueCustomers.length > 3 ? ` y ${uniqueCustomers.length - 3} más` : "";
    toast(`Se descartó un cambio de saldo en ${first}${rest} (cliente borrado en otro dispositivo)`);
  }
}

/**
 * ¿Los ajustes de la nube reemplazan a los locales? En empate de tiempo solo
 * si no hay un cambio local pendiente de subir (si no, se perdía el ajuste
 * recién guardado al releer la fila sin haberla subido aún).
 */
function cloudSettingsWin(deps: SyncDeps, cloudTime: number, localTime: number): boolean {
  if (!deps.store.getState().settings.updated_at) return true;
  if (cloudTime > localTime) return true;
  return cloudTime === localTime && !deps.tracker.isDirty("products", SETTINGS_ROW_ID);
}

/** La fila __pos_settings__ no entra a products: alimenta state.settings. */
function applySettingsRow(deps: SyncDeps, rows: Array<Record<string, unknown>>): Array<Record<string, unknown>> {
  const settingsRow = rows.find((row) => row.id === SETTINGS_ROW_ID);
  if (settingsRow) {
    const cloudSettings = sanitizeCloudSettings(settingsRow.settings);
    if (cloudSettings && Object.keys(cloudSettings).length) {
      const local = deps.store.getState().settings;
      const cloudTime = Date.parse(String(cloudSettings.updated_at || settingsRow.updated_at || "")) || 0;
      const localTime = Date.parse(String(local.updated_at || "")) || 0;
      if (cloudSettingsWin(deps, cloudTime, localTime)) {
        deps.store.update((state) => {
          state.settings = { ...state.settings, ...cloudSettings, updated_at: String(cloudSettings.updated_at || settingsRow.updated_at || nowISO()) };
        });
      }
    }
  }
  return rows.filter((row) => row.id !== SETTINGS_ROW_ID);
}

export async function pullSettings(deps: SyncDeps, token: string): Promise<void> {
  try {
    const result = await deps.client.rpc("pos_settings", token);
    // Respaldo incondicional (sin filtro incremental): sana los ajustes
    // aunque el pull de products haya omitido la fila.
    const settings = sanitizeCloudSettings(result);
    if (!settings || !Object.keys(settings).length) return;
    const local = deps.store.getState().settings;
    const cloudTime = Date.parse(String(settings.updated_at || "")) || 0;
    const localTime = Date.parse(String(local.updated_at || "")) || 0;
    if (cloudSettingsWin(deps, cloudTime, localTime)) {
      deps.store.update((state) => {
        state.settings = { ...state.settings, ...settings, updated_at: String(settings.updated_at || nowISO()) };
      });
    }
  } catch {
    /* la función puede no existir todavía; los ajustes llegan por la fila products */
  }
}
