import { nowISO } from "../core/dates";
import type { SyncTableKey } from "../core/types";
import type { AppState } from "../domain/app-state";
import type { AuthService } from "../domain/auth-service";
import type { Store } from "../domain/store";
import type { ChangeTracker } from "./change-tracker";
import type { Repositories } from "./repositories";
import type { SupabaseClient } from "./supabase-client";
import type { SyncDeps } from "./sync-deps";
import { applyPulled, fetchTable, pullSettings, warnConflicts } from "./sync-pull";
import { push } from "./sync-push";
import { syncTablesFor } from "./sync-tables";
import type { SyncResult } from "./sync-tables";

// La API pública del motor sigue disponible desde este archivo.
export { PULL_OVERLAP_MS, pullSince, syncTablesFor } from "./sync-tables";
export type { SyncResult } from "./sync-tables";
export { sanitizeCloudSettings, settingsProductRow } from "./sync-settings";

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

  private get deps(): SyncDeps {
    return { store: this.store, client: this.client, auth: this.auth, tracker: this.tracker, repos: this.repos };
  }

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
      const fetched = await Promise.all(tables.map((table) => fetchTable(this.deps, table, token)));
      fetched.forEach((result, index) => {
        if (!result) return;
        const table = tables[index]!;
        applyPulled(this.deps, table, result).forEach((id) => conflicts.push({ table, id }));
      });
      await pullSettings(this.deps, token);
      const serverStock = await this.checkServerStock(token);
      // Con stock en el servidor, el vendedor no sube existencias: las mueve
      // Postgres con cada venta/compra/merma (y rechazaría las suyas).
      const vendorBlocked = new Set<SyncTableKey>(["products", "branches", "month_closings"]);
      if (serverStock) vendorBlocked.add("product_stocks");
      if (!isAdmin) {
        // El vendedor no sube estas tablas (las gobierna el servidor): sus
        // pendientes se descartan para que el aviso de sync no quede
        // encendido para siempre ni tape pendientes de verdad.
        vendorBlocked.forEach((table) => {
          const stale = this.tracker.takeIds(table);
          if (stale?.length) this.tracker.clear(table, stale);
        });
      }
      const pushable = isAdmin ? tables : tables.filter((table) => !vendorBlocked.has(table));
      // Una fila rechazada no frena las demás tablas: se sigue y se avisa al final.
      const rejected: string[] = [];
      for (const table of pushable) {
        const message = await push(this.deps, table, token);
        if (message) rejected.push(message);
      }
      if (conflicts.length) warnConflicts(this.deps, conflicts);
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
}
