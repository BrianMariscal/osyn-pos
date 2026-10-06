import { nowISO, rowTime } from "../core/dates";
import type { SyncTableKey } from "../core/types";
import type {
  AppState,
  StateTableKey
} from "../domain/app-state";
import type { Store } from "../domain/store";
import type { Branch, Customer, Expense, InventoryCount, Merma, MonthClosing, Product, ProductStock, Purchase, Sale, Shift, Supplier } from "../core/types";
import type { ChangeTracker } from "./change-tracker";

export interface BaseRow {
  id: string;
  updated_at: string;
  deleted?: boolean;
}

/**
 * Acceso tipado a una tabla del estado. Toda escritura marca la fila como
 * dirty (pendiente de sincronizar). Las filas de la nube entran por
 * mergeFromCloud y NO se marcan dirty.
 *
 * `counterKeys` son campos mutables acumulativos (product_stocks.stock,
 * customers.balance). Al escribir se acumula su delta local; cuando la nube
 * trae una versión más nueva con cambios locales pendientes, en lugar de
 * sobreescribir (perder la venta/pago offline) se aplica el delta sobre el
 * valor de la nube. `arrayKeys` (customers.movements) se fusionan por id.
 */
export class Repository<T extends BaseRow> {
  constructor(
    private store: Store<AppState>,
    private table: StateTableKey,
    private tracker: ChangeTracker,
    private counterKeys: readonly string[] = [],
    private arrayKeys: readonly string[] = []
  ) {}

  /** Filas vivas (sin tombstone). */
  list(): T[] {
    return (this.store.getState()[this.table] as unknown as T[]).filter((row) => !row.deleted);
  }

  /** Todas las filas, incluidas las eliminadas (tombstones para sync). */
  all(): T[] {
    return this.store.getState()[this.table] as unknown as T[];
  }

  byId(id: string): T | undefined {
    return this.all().find((row) => row.id === id);
  }

  upsert(row: T): void {
    const rows = this.all();
    const previous = rows.find((r) => r.id === row.id);
    const exists = Boolean(previous);
    const next = exists ? rows.map((r) => (r.id === row.id ? row : r)) : [row, ...rows];
    this.commit(next);
    this.tracker.recordDelta(this.table as SyncTableKey, row.id, previous ? this.deltaOf(previous, row) : {});
    this.tracker.mark(this.table as SyncTableKey, row.id);
  }

  upsertMany(rows: T[]): void {
    if (!rows.length) return;
    const byId = new Map(this.all().map((r) => [r.id, r]));
    const previous = new Map(byId);
    rows.forEach((row) => byId.set(row.id, row));
    const newestFirst = [...byId.values()].sort((a, b) => rowTime(b) - rowTime(a));
    this.commit(newestFirst);
    for (const row of rows) {
      const prev = previous.get(row.id);
      if (prev && this.counterKeys.length) {
        this.tracker.recordDelta(this.table as SyncTableKey, row.id, this.deltaOf(prev, row));
      }
      this.tracker.mark(this.table as SyncTableKey, row.id);
    }
  }

  /**
   * Cambio solo local, sin marcarlo para subir: lo que el servidor calcula por
   * su cuenta (stock movido por ventas/compras/mermas). Conserva el updated_at
   * anterior para que el valor de la nube lo reemplace en el siguiente pull.
   */
  applyLocal(row: T): void {
    const rows = this.all();
    const previous = rows.find((r) => r.id === row.id);
    const next = { ...row, updated_at: previous?.updated_at ?? row.updated_at };
    this.commit(previous ? rows.map((r) => (r.id === row.id ? next : r)) : [next, ...rows]);
  }

  softDelete(id: string): void {
    const row = this.byId(id);
    if (!row || row.deleted) return;
    this.upsert({ ...row, deleted: true, updated_at: nowISO() });
  }

  /**
   * Mezcla filas de la nube por updated_at (last-write-wins).
   * Si la nube es más nueva pero hay un cambio local sin sincronizar en un
   * contador, se aplica el delta pendiente sobre el valor de la nube
   * (no se pierde la venta/pago offline). Devuelve ids con conflicto que la
   * app no pudo resolver por sí sola (p. ej. la nube eliminó una fila local
   * sucia), para que el dueño las revise.
   */
  mergeFromCloud(cloudRows: T[]): string[] {
    const conflicts: string[] = [];
    if (!cloudRows.length) return conflicts;
    const current = this.all();
    const byId = new Map(current.map((row) => [row.id, row]));
    let changed = false;
    for (const cloud of cloudRows) {
      const local = byId.get(cloud.id);
      if (!local) {
        byId.set(cloud.id, cloud);
        changed = true;
      } else if (rowTime(cloud) > rowTime(local)) {
        const dirty = this.counterKeys.length && this.tracker.isDirty(this.table, cloud.id);
        if (cloud.deleted && dirty && this.counterDiffer(local, cloud)) {
          // La nube borró la fila y localmente hay un cambio sin subir: se
          // respeta el borrado pero se avisa (el cambio local se descarta).
          conflicts.push(cloud.id);
          byId.set(cloud.id, cloud);
          changed = true;
        } else if (!cloud.deleted && dirty) {
          const merged = this.reconcile(local, cloud);
          if (merged) {
            byId.set(cloud.id, merged);
            this.tracker.clearDelta(this.table as SyncTableKey, cloud.id);
          } else {
            byId.set(cloud.id, cloud);
          }
          changed = true;
        } else {
          byId.set(cloud.id, cloud);
          changed = true;
        }
      }
    }
    if (!changed) return conflicts;
    const merged = [...byId.values()].sort((a, b) => rowTime(b) - rowTime(a));
    this.commit(merged);
    return conflicts;
  }

  /** Cambio de contador entre la versión anterior y la nueva (acumulable). */
  private deltaOf(a: T, b: T): Record<string, number> {
    const delta: Record<string, number> = {};
    const prev = a as unknown as Record<string, unknown>;
    const next = b as unknown as Record<string, unknown>;
    for (const key of this.counterKeys) {
      const before = prev[key];
      const after = next[key];
      if (typeof before === "number" && typeof after === "number" && before !== after) {
        delta[key] = after - before;
      }
    }
    return delta;
  }

  private counterDiffer(a: T, b: T): boolean {
    return this.counterKeys.some((key) => {
      const left = (a as unknown as Record<string, unknown>)[key];
      const right = (b as unknown as Record<string, unknown>)[key];
      return left !== right;
    });
  }

  /**
   * Rebase de una fila local sucia sobre la versión más nueva de la nube:
   * el contador queda en `nube + delta local` y los arreglos (movimientos)
   * se fusionan por id, sin duplicar lo que la nube ya tiene.
   */
  private reconcile(local: T, cloud: T): T | null {
    const delta = this.tracker.pendingDelta(this.table as SyncTableKey, cloud.id);
    if (!delta || !Object.keys(delta).length) return null;
    const merged = { ...cloud } as unknown as Record<string, unknown>;
    for (const key of this.counterKeys) {
      const base = cloud[key as keyof T];
      if (typeof base === "number") merged[key] = base + (delta[key] ?? 0);
    }
    for (const key of this.arrayKeys) {
      const cloudList = Array.isArray(merged[key]) ? (merged[key] as Array<{ id?: string }>) : [];
      const localList = Array.isArray((local as unknown as Record<string, unknown>)[key])
        ? ((local as unknown as Record<string, unknown>)[key] as Array<{ id?: string }>)
        : [];
      const seen = new Set(cloudList.map((item) => item?.id).filter(Boolean));
      const extra = localList.filter((item) => item?.id && !seen.has(item.id));
      merged[key] = [...cloudList, ...extra];
    }
    merged.updated_at = nowISO();
    return merged as unknown as T;
  }

  private commit(rows: T[]): void {
    this.store.update((state) => {
      (state as unknown as Record<string, unknown>)[this.table] = rows;
    });
  }
}

export class Repositories {
  branches: Repository<Branch>;
  suppliers: Repository<Supplier>;
  products: Repository<Product>;
  stocks: Repository<ProductStock>;
  customers: Repository<Customer>;
  sales: Repository<Sale>;
  expenses: Repository<Expense>;
  purchases: Repository<Purchase>;
  mermas: Repository<Merma>;
  shifts: Repository<Shift>;
  closings: Repository<MonthClosing>;
  counts: Repository<InventoryCount>;

  constructor(store: Store<AppState>, tracker: ChangeTracker) {
    this.branches = new Repository<Branch>(store, "branches", tracker);
    this.suppliers = new Repository<Supplier>(store, "suppliers", tracker);
    this.products = new Repository<Product>(store, "products", tracker);
    this.stocks = new Repository<ProductStock>(store, "product_stocks", tracker, ["stock"]);
    this.customers = new Repository<Customer>(store, "customers", tracker, ["balance"], ["movements"]);
    this.sales = new Repository<Sale>(store, "sales", tracker);
    this.expenses = new Repository<Expense>(store, "expenses", tracker);
    this.purchases = new Repository<Purchase>(store, "purchases", tracker);
    this.mermas = new Repository<Merma>(store, "mermas", tracker);
    this.shifts = new Repository<Shift>(store, "shifts", tracker);
    this.closings = new Repository<MonthClosing>(store, "month_closings", tracker);
    this.counts = new Repository<InventoryCount>(store, "inventory_counts", tracker);
  }

  repoFor(table: SyncTableKey): Repository<BaseRow> {
    const map: Record<SyncTableKey, Repository<BaseRow>> = {
      branches: this.branches,
      suppliers: this.suppliers,
      products: this.products,
      product_stocks: this.stocks,
      customers: this.customers,
      sales: this.sales,
      expenses: this.expenses,
      purchases: this.purchases,
      mermas: this.mermas,
      shifts: this.shifts,
      month_closings: this.closings,
      inventory_counts: this.counts
    };
    return map[table];
  }
}
