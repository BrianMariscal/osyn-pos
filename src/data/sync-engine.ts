import { nowISO } from "../core/dates";
import { SETTINGS_ROW_ID, TAB_TABLES } from "../core/types";
import type { Settings, SyncTableKey } from "../core/types";
import type { AppState } from "../domain/app-state";
import type { AuthService } from "../domain/auth-service";
import type { Store } from "../domain/store";
import type { ChangeTracker } from "./change-tracker";
import type { Repositories, BaseRow } from "./repositories";
import type { SupabaseClient } from "./supabase-client";
import { toast } from "../ui/components/toast";
import { reportIssue } from "../core/monitoring";

const SYNC_TABLES: readonly SyncTableKey[] = [
  "branches",
  "suppliers",
  "products",
  "product_stocks",
  "customers",
  "sales",
  "returns",
  "expenses",
  "purchases",
  "mermas",
  "shifts",
  "month_closings",
  "inventory_counts"
];

const SUPABASE_COLUMNS: Record<SyncTableKey, readonly string[]> = {
  branches: ["id", "name", "address", "active", "created_at", "updated_at", "deleted", "data"],
  suppliers: ["id", "name", "phone", "notes", "created_at", "updated_at", "deleted", "data"],
  products: ["id", "name", "category", "cost", "price", "active", "created_at", "updated_at", "deleted", "data"],
  product_stocks: ["id", "product_id", "branch_id", "stock", "min_stock", "updated_at", "deleted", "data"],
  customers: ["id", "branch_id", "name", "phone", "balance", "movements", "created_at", "updated_at", "deleted", "data"],
  sales: ["id", "branch_id", "items", "total", "cost", "profit", "payment", "customer_id", "created_at", "updated_at", "deleted", "data"],
  returns: ["id", "branch_id", "sale_id", "folio", "items", "total", "cost", "payment", "customer_id", "reason", "note", "cashier", "created_at", "updated_at", "deleted", "data"],
  expenses: ["id", "branch_id", "concept", "amount", "category", "created_at", "updated_at", "deleted", "data"],
  purchases: ["id", "branch_id", "supplier", "product_id", "product_name", "um", "qty", "total", "created_at", "updated_at", "deleted", "data"],
  mermas: ["id", "branch_id", "product_id", "product_name", "um", "qty", "reason", "note", "cost_impact", "created_at", "updated_at", "deleted", "data"],
  shifts: [
    "id", "branch_id", "summary", "opening_cash", "counted_cash", "withdrawn_cash",
    "next_opening_cash", "expected_cash_with_base", "difference", "distribution_difference",
    "notes", "closed_at", "updated_at", "deleted", "data"
  ],
  month_closings: ["id", "branch_id", "month", "report", "closed_at", "updated_at", "deleted", "data"],
  inventory_counts: ["id", "branch_id", "started_at", "applied_at", "summary", "incidences", "updated_at", "deleted", "data"]
};

function toSupabaseRow(table: SyncTableKey, row: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const column of SUPABASE_COLUMNS[table]) {
    out[column] = column === "data" ? row : (row[column] ?? null);
  }
  return out;
}

function fromSupabaseRow(row: Record<string, unknown>): Record<string, unknown> {
  const data = row.data;
  const merged: Record<string, unknown> =
    data && typeof data === "object" ? { ...(data as Record<string, unknown>), ...row } : { ...row };
  delete merged.data;
  delete merged.synced_at;
  return merged;
}

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

function employeeTables(vendorTabs: readonly string[]): SyncTableKey[] {
  const tables = new Set<SyncTableKey>(["products", "product_stocks", "branches"]);
  vendorTabs.forEach((tab) => {
    (TAB_TABLES[tab as keyof typeof TAB_TABLES] ?? []).forEach((table) => tables.add(table));
  });
  return SYNC_TABLES.filter((table) => tables.has(table));
}

/**
 * Errores de PostgREST causados por el contenido de una fila (restricción
 * check/FK/RLS, dato inválido). 401 (sesión) y 5xx (servidor) no lo son.
 */
function isRowRejection(status: number): boolean {
  return status === 400 || status === 403 || status === 409 || status === 422;
}

/** Margen hacia atrás del pull incremental (tolera relojes desfasados entre dispositivos). */
export const PULL_OVERLAP_MS = 10 * 60_000;

export function pullSince(lastPulledAt: string): string {
  const time = Date.parse(lastPulledAt);
  return Number.isFinite(time) ? new Date(time - PULL_OVERLAP_MS).toISOString() : lastPulledAt;
}

/** Tablas que sincroniza un usuario (todas para gerencia; según sus pantallas para vendedor). */
export function syncTablesFor(isAdmin: boolean, vendorTabs: readonly string[]): SyncTableKey[] {
  return isAdmin ? [...SYNC_TABLES] : employeeTables(vendorTabs);
}

export interface SyncResult {
  ok: boolean;
  error?: string;
}

/**
 * Sync incremental contra Supabase:
 * - Pull: solo filas con synced_at (reloj del servidor) desde la última lectura.
 * - Push: solo filas marcadas dirty por los repositorios.
 * - Borrados: propagados con tombstones (deleted: true).
 * - Conflicto: last-write-wins por updated_at a nivel de fila.
 */
export class SyncEngine {
  private timer: ReturnType<typeof setTimeout> | undefined;
  private running: Promise<SyncResult> | null = null;
  private queued = false;
  private serverStockCheckedAt = 0;

  constructor(
    private store: Store<AppState>,
    private client: SupabaseClient,
    private auth: AuthService,
    private tracker: ChangeTracker,
    private repos: Repositories
  ) {}

  schedule(delay = 400): void {
    if (!navigator.onLine || !this.client.configured || !this.auth.session) return;
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      void this.syncNow({ quiet: true });
    }, delay);
  }

  async syncNow(options: { quiet?: boolean } = {}): Promise<SyncResult> {
    if (this.running) {
      this.queued = true;
      return this.running;
    }
    this.running = this.runSync(options).finally(() => {
      this.running = null;
      if (this.queued) {
        this.queued = false;
        this.schedule(100);
      }
    });
    return this.running;
  }

  private async runSync({ quiet }: { quiet?: boolean }): Promise<SyncResult> {
    if (!navigator.onLine) return { ok: false, error: quiet ? "Sin internet" : "Sin internet, se sincronizará después" };
    if (!this.client.configured) return { ok: false, error: "Faltan datos de Supabase" };
    const sessionBefore = this.auth.session;
    if (!sessionBefore) return { ok: false, error: "Inicia sesión para sincronizar" };
    await this.auth.refreshIfNeeded();
    const session = this.auth.session;
    if (!session) return { ok: false, error: "Sesión expirada" };
    const token = session.access_token;
    const isAdmin = this.auth.isAdmin();
    const tables = syncTablesFor(isAdmin, this.store.getState().settings.vendorTabs);
    this.setSyncing(true);
    try {
      const conflicts: Array<{ table: SyncTableKey; id: string }> = [];
      // Descarga en paralelo (antes una tabla tras otra) y mezcla en orden.
      const fetched = await Promise.all(tables.map((table) => this.fetchTable(table, token)));
      fetched.forEach((result, index) => {
        if (!result) return;
        const table = tables[index]!;
        this.applyPulled(table, result).forEach((id) => conflicts.push({ table, id }));
      });
      await this.pullSettings(token);
      const serverStock = await this.checkServerStock(token);
      // Con stock en el servidor, el vendedor no sube existencias: las mueve
      // Postgres con cada venta/compra/merma (y rechazaría las suyas).
      const vendorBlocked = new Set<SyncTableKey>(["products", "branches", "month_closings"]);
      if (serverStock) vendorBlocked.add("product_stocks");
      if (!isAdmin && serverStock) {
        const stale = this.tracker.takeIds("product_stocks");
        if (stale?.length) this.tracker.clear("product_stocks", stale);
      }
      const pushable = isAdmin ? tables : tables.filter((table) => !vendorBlocked.has(table));
      // Una fila rechazada no frena las demás tablas: se sigue y se avisa al final.
      const rejected: string[] = [];
      for (const table of pushable) {
        const message = await this.push(table, token);
        if (message) rejected.push(message);
      }
      if (conflicts.length) this.warnConflicts(conflicts);
      const error = rejected.length ? rejected.join(" · ") : null;
      this.store.update((state) => {
        state.sync = { ...state.sync, syncing: false, lastSyncAt: nowISO(), pending: this.tracker.pendingCount(), error };
      });
      return error ? { ok: false, error } : { ok: true };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Error sincronizando";
      this.store.update((state) => {
        state.sync = { ...state.sync, syncing: false, pending: this.tracker.pendingCount(), error: message };
      });
      return { ok: false, error: message };
    }
  }

  /**
   * ¿Ya corre la migración stock-servidor? Se pregunta una vez por sesión si
   * ya está, o cada 5 minutos mientras no. Se guarda en el estado para que las
   * ventas sin internet sigan el mismo modo al recargar.
   */
  private async checkServerStock(token: string): Promise<boolean> {
    const known = Boolean(this.store.getState().sync.serverStock);
    const now = Date.now();
    if (known && this.serverStockCheckedAt) return true;
    if (!known && now - this.serverStockCheckedAt < 5 * 60_000) return false;
    this.serverStockCheckedAt = now;
    let enabled = known;
    try {
      enabled = (await this.client.rpc("pos_server_stock", token)) === true;
    } catch {
      // La función no existe (migración pendiente) o falló la red: se conserva lo sabido.
      enabled = known;
    }
    if (enabled !== known) {
      this.store.update((state) => {
        state.sync = { ...state.sync, serverStock: enabled };
      });
    }
    return enabled;
  }

  private setSyncing(value: boolean): void {
    this.store.update((state) => {
      state.sync = { ...state.sync, syncing: value };
    });
  }

  /** synced_at si la tabla ya lo tiene; si no (migración pendiente), updated_at. */
  private async fetchTable(table: SyncTableKey, token: string): Promise<PullPage> {
    return (await this.fetchBySyncedAt(table, token)) ?? (await this.fetchByUpdatedAt(table, token));
  }

  private applyPulled(table: SyncTableKey, page: NonNullable<PullPage>): string[] {
    let mapped = page.rows.map(fromSupabaseRow);
    if (table === "products") {
      mapped = this.applySettingsRow(mapped);
    }
    const conflicts = this.repos.repoFor(table).mergeFromCloud(mapped as unknown as BaseRow[]);
    this.store.update((state) => {
      state.sync = {
        ...state.sync,
        lastPulledAt: page.capturedAt ? { ...state.sync.lastPulledAt, [table]: page.capturedAt } : state.sync.lastPulledAt,
        syncCursors: page.cursor ? { ...state.sync.syncCursors, [table]: page.cursor } : state.sync.syncCursors
      };
    });
    return conflicts;
  }

  /**
   * Lectura incremental por synced_at, que pone el servidor al recibir cada
   * fila. A diferencia de updated_at (reloj del dispositivo, momento de la
   * edición), no pierde filas subidas tarde ni con relojes desfasados.
   * Sin cursor previo se lee la tabla completa, lo que también recupera las
   * filas que la lectura por updated_at se saltó antes.
   */
  private async fetchBySyncedAt(table: SyncTableKey, token: string): Promise<PullPage> {
    const cursor = this.store.getState().sync.syncCursors[table];
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
      const res = await this.client.rest(`${table}?${params.toString()}`, token);
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
  private async fetchByUpdatedAt(table: SyncTableKey, token: string): Promise<PullPage> {
    const since = this.store.getState().sync.lastPulledAt[table];
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
    const res = await this.client.rest(`${table}?${params.toString()}`, token);
    if (res.status === 404) {
      // Tabla sin migrar todavía en Supabase: se salta sin romper la sync
      return null;
    }
    if (!res.ok) throw new Error(`Error leyendo ${table}: ${await res.text()}`);
    return { rows: (await res.json()) as Array<Record<string, unknown>>, capturedAt };
  }

  /**
   * La mayoría de los conflictos de contadores (stock/balance) se resuelven
   * solos en el merge (delta local aplicado sobre la nube). Aquí solo llegan
   * los que la app no pudo rebasar: la nube borró una fila que tenía un cambio
   * local sin subir, y ese cambio se descartó. Se avisa para revisión.
   */
  private warnConflicts(conflicts: Array<{ table: SyncTableKey; id: string }>): void {
    const stockNames: string[] = [];
    const customerNames: string[] = [];
    for (const { table, id } of conflicts) {
      if (table === "product_stocks") {
        const productId = id.slice(0, id.lastIndexOf(":"));
        const name = this.repos.products.byId(productId)?.name;
        if (name) stockNames.push(name);
      } else if (table === "customers") {
        const name = this.repos.customers.byId(id)?.name;
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
  private cloudSettingsWin(cloudTime: number, localTime: number): boolean {
    if (!this.store.getState().settings.updated_at) return true;
    if (cloudTime > localTime) return true;
    return cloudTime === localTime && !this.tracker.isDirty("products", SETTINGS_ROW_ID);
  }

  /** La fila __pos_settings__ no entra a products: alimenta state.settings. */
  private applySettingsRow(rows: Array<Record<string, unknown>>): Array<Record<string, unknown>> {
    const settingsRow = rows.find((row) => row.id === SETTINGS_ROW_ID);
    if (settingsRow) {
      const cloudSettings = sanitizeCloudSettings(settingsRow.settings);
      if (cloudSettings && Object.keys(cloudSettings).length) {
        const local = this.store.getState().settings;
        const cloudTime = Date.parse(String(cloudSettings.updated_at || settingsRow.updated_at || "")) || 0;
        const localTime = Date.parse(String(local.updated_at || "")) || 0;
        if (this.cloudSettingsWin(cloudTime, localTime)) {
          this.store.update((state) => {
            state.settings = { ...state.settings, ...cloudSettings, updated_at: String(cloudSettings.updated_at || settingsRow.updated_at || nowISO()) };
          });
        }
      }
    }
    return rows.filter((row) => row.id !== SETTINGS_ROW_ID);
  }

  private async pullSettings(token: string): Promise<void> {
    try {
      const result = await this.client.rpc("pos_settings", token);
      // Respaldo incondicional (sin filtro incremental): sana los ajustes
      // aunque el pull de products haya omitido la fila.
      const settings = sanitizeCloudSettings(result);
      if (!settings || !Object.keys(settings).length) return;
      const local = this.store.getState().settings;
      const cloudTime = Date.parse(String(settings.updated_at || "")) || 0;
      const localTime = Date.parse(String(local.updated_at || "")) || 0;
      if (this.cloudSettingsWin(cloudTime, localTime)) {
        this.store.update((state) => {
          state.settings = { ...state.settings, ...settings, updated_at: String(settings.updated_at || nowISO()) };
        });
      }
    } catch {
      /* la función puede no existir todavía; los ajustes llegan por la fila products */
    }
  }

  /** Sube los cambios pendientes; devuelve un aviso si la nube rechazó filas. */
  private async push(table: SyncTableKey, token: string): Promise<string | null> {
    const dirtyRaw = this.tracker.takeIds(table);
    if (!dirtyRaw || !dirtyRaw.length) return null;
    // La fila de ajustes (nombre/logo/WhatsApp) solo la sube el dueño. Si quedó
    // pendiente en un dispositivo de admin/vendedor (por un guardado anterior),
    // se descarta para no repetir errores de RLS (42501).
    const isOwner = this.auth.isOwner();
    const dirtyIds = isOwner ? dirtyRaw : dirtyRaw.filter((id) => id !== SETTINGS_ROW_ID);
    if (!dirtyIds.length) {
      this.tracker.clear(table, dirtyRaw);
      return null;
    }
    let sourceRows: Array<Record<string, unknown>>;
    if (table === "products") {
      const rows = this.repos.products.all() as unknown as Array<Record<string, unknown>>;
      sourceRows = dirtyIds.includes(SETTINGS_ROW_ID)
        ? [...rows, settingsProductRow(this.store.getState().settings)]
        : rows;
    } else {
      sourceRows = this.repos.repoFor(table).all() as unknown as Array<Record<string, unknown>>;
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
      const res = await this.upsert(table, token, batch);
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
        const one = await this.upsert(table, token, [row]);
        if (one.ok) continue;
        if (!isRowRejection(one.status)) throw new Error(`Error sincronizando ${table}: ${await one.text()}`);
        rejectedIds.add(String(row.id));
        if (!firstError) firstError = await one.text();
      }
    }
    // Las rechazadas siguen pendientes (no se pierden) y se reintentan en cada sync.
    this.tracker.clear(table, dirtyIds.filter((id) => !rejectedIds.has(id)));
    this.store.update((state) => {
      state.sync = { ...state.sync, pending: this.tracker.pendingCount() };
    });
    if (!rejectedIds.size) return null;
    reportIssue(`Sync: la nube rechazó filas de ${table}`, { table, count: rejectedIds.size, error: firstError.slice(0, 500) });
    return `${rejectedIds.size} cambio(s) de ${table} rechazado(s) por la nube: ${firstError.slice(0, 200)}`;
  }

  private upsert(table: SyncTableKey, token: string, rows: Array<Record<string, unknown>>): Promise<Response> {
    return this.client.rest(`${table}?on_conflict=id`, token, {
      method: "POST",
      headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
      body: JSON.stringify(rows)
    });
  }
}

/** Fila falsa de producto que transporta los ajustes (id __pos_settings__). */
export function settingsProductRow(settings: Settings): Record<string, unknown> {
  const updatedAt = settings.updated_at || nowISO();
  return {
    id: SETTINGS_ROW_ID,
    name: "Configuración POS",
    category: "Sistema",
    cost: 0,
    price: 0,
    active: false,
    updated_at: updatedAt,
    settings
  };
}

const CLOUD_SETTING_KEYS = [
  "storeName",
  "logo",
  "whatsappNumber",
  "whatsapp2",
  "whatsapp3",
  "vendorTabs",
  "adminTabs",
  "assistantVoiceEnabled",
  "theme",
  "updated_at"
] as const;

/**
 * Normaliza ajustes venidos de la nube (fila __pos_settings__ o RPC
 * pos_settings). PostgREST devuelve el jsonb de la función TAL CUAL (objeto
 * plano), no envuelto en { settings }; se aceptan ambas formas. Solo pasan
 * claves conocidas para no contaminar el estado con basura.
 */
export function sanitizeCloudSettings(raw: unknown): Partial<Settings> | null {
  if (!raw || typeof raw !== "object") return null;
  const source = raw as Record<string, unknown>;
  const candidate =
    source.settings && typeof source.settings === "object"
      ? (source.settings as Record<string, unknown>)
      : source;
  const out: Record<string, unknown> = {};
  for (const key of CLOUD_SETTING_KEYS) {
    const value = candidate[key];
    if (value !== undefined) out[key] = value;
  }
  return Object.keys(out).length ? (out as Partial<Settings>) : null;
}
