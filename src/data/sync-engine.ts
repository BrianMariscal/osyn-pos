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

const SYNC_TABLES: readonly SyncTableKey[] = [
  "branches",
  "suppliers",
  "products",
  "product_stocks",
  "customers",
  "sales",
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
  return merged;
}

function employeeTables(vendorTabs: readonly string[]): SyncTableKey[] {
  const tables = new Set<SyncTableKey>(["products", "product_stocks", "branches"]);
  vendorTabs.forEach((tab) => {
    (TAB_TABLES[tab as keyof typeof TAB_TABLES] ?? []).forEach((table) => tables.add(table));
  });
  return SYNC_TABLES.filter((table) => tables.has(table));
}

export interface SyncResult {
  ok: boolean;
  error?: string;
}

/**
 * Sync incremental contra Supabase:
 * - Pull: solo filas con updated_at > última lectura por tabla.
 * - Push: solo filas marcadas dirty por los repositorios.
 * - Borrados: propagados con tombstones (deleted: true).
 * - Conflicto: last-write-wins por updated_at a nivel de fila.
 */
export class SyncEngine {
  private timer: ReturnType<typeof setTimeout> | undefined;
  private running: Promise<SyncResult> | null = null;
  private queued = false;

  constructor(
    private store: Store<AppState>,
    private client: SupabaseClient,
    private auth: AuthService,
    private tracker: ChangeTracker,
    private repos: Repositories
  ) {}

  schedule(delay = 2000): void {
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
    const tables = isAdmin ? [...SYNC_TABLES] : employeeTables(this.store.getState().settings.vendorTabs);
    this.setSyncing(true);
    try {
      const conflicts: Array<{ table: SyncTableKey; id: string }> = [];
      for (const table of tables) {
        const tableConflicts = await this.pull(table, token);
        tableConflicts.forEach((id) => conflicts.push({ table, id }));
      }
      await this.pullSettings(token);
      const pushable = isAdmin
        ? tables
        : tables.filter((table) => table !== "products" && table !== "branches" && table !== "month_closings");
      for (const table of pushable) {
        await this.push(table, token);
      }
      if (conflicts.length) this.warnConflicts(conflicts);
      this.store.update((state) => {
        state.sync = { ...state.sync, syncing: false, lastSyncAt: nowISO(), pending: this.tracker.pendingCount(), error: null };
      });
      return { ok: true };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Error sincronizando";
      this.store.update((state) => {
        state.sync = { ...state.sync, syncing: false, pending: this.tracker.pendingCount(), error: message };
      });
      return { ok: false, error: message };
    }
  }

  private setSyncing(value: boolean): void {
    this.store.update((state) => {
      state.sync = { ...state.sync, syncing: value };
    });
  }

  private async pull(table: SyncTableKey, token: string): Promise<string[]> {
    const since = this.store.getState().sync.lastPulledAt[table];
    const capturedAt = nowISO();
    const params = new URLSearchParams({ select: "*" });
    if (since) {
      // gte (no gt): lastPulledAt se captura al INICIAR el pull y los
      // timestamps tienen precisión de milisegundos. Con gt estricto, una fila
      // guardada en el mismo milisegundo (o con relojes desfasados entre
      // dispositivos, o un push retrasado por offline) quedaba excluida para
      // siempre. Releer el borde es seguro: el merge es idempotente
      // (last-write-wins por updated_at, en empate gana lo local).
      params.set("updated_at", `gte.${since}`);
      params.set("order", "updated_at.asc");
    }
    const res = await this.client.rest(`${table}?${params.toString()}`, token);
    if (res.status === 404) {
      // Tabla sin migrar todavía en Supabase: se salta sin romper la sync
      return [];
    }
    if (!res.ok) throw new Error(`Error leyendo ${table}: ${await res.text()}`);
    const rows = (await res.json()) as Array<Record<string, unknown>>;
    let mapped = rows.map(fromSupabaseRow);
    if (table === "products") {
      mapped = this.applySettingsRow(mapped);
    }
    const conflicts = this.repos.repoFor(table).mergeFromCloud(mapped as unknown as BaseRow[]);
    this.store.update((state) => {
      state.sync.lastPulledAt = { ...state.sync.lastPulledAt, [table]: capturedAt };
    });
    return conflicts;
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

  /** La fila __pos_settings__ no entra a products: alimenta state.settings. */
  private applySettingsRow(rows: Array<Record<string, unknown>>): Array<Record<string, unknown>> {
    const settingsRow = rows.find((row) => row.id === SETTINGS_ROW_ID);
    if (settingsRow) {
      const cloudSettings = sanitizeCloudSettings(settingsRow.settings);
      if (cloudSettings && Object.keys(cloudSettings).length) {
        const local = this.store.getState().settings;
        const cloudTime = Date.parse(String(cloudSettings.updated_at || settingsRow.updated_at || "")) || 0;
        const localTime = Date.parse(String(local.updated_at || "")) || 0;
        if (!local.updated_at || cloudTime >= localTime) {
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
      if (!local.updated_at || cloudTime >= localTime) {
        this.store.update((state) => {
          state.settings = { ...state.settings, ...settings, updated_at: String(settings.updated_at || nowISO()) };
        });
      }
    } catch {
      /* la función puede no existir todavía; los ajustes llegan por la fila products */
    }
  }

  private async push(table: SyncTableKey, token: string): Promise<void> {
    const dirtyRaw = this.tracker.takeIds(table);
    if (!dirtyRaw || !dirtyRaw.length) return;
    // La fila de ajustes (nombre/logo/WhatsApp) solo la sube el dueño. Si quedó
    // pendiente en un dispositivo de admin/vendedor (por un guardado anterior),
    // se descarta para no repetir errores de RLS (42501).
    const isOwner = this.auth.isOwner();
    const dirtyIds = isOwner ? dirtyRaw : dirtyRaw.filter((id) => id !== SETTINGS_ROW_ID);
    if (!dirtyIds.length) {
      this.tracker.clear(table, dirtyRaw);
      return;
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
    if (!rows.length) return;
    const res = await this.client.rest(`${table}?on_conflict=id`, token, {
      method: "POST",
      headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
      body: JSON.stringify(rows)
    });
    if (res.status === 404) {
      // Tabla sin migrar: los cambios quedan pendientes y se reintentan
      return;
    }
    if (!res.ok) throw new Error(`Error sincronizando ${table}: ${await res.text()}`);
    this.tracker.clear(table, dirtyIds);
    this.store.update((state) => {
      state.sync = { ...state.sync, pending: this.tracker.pendingCount() };
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
