import type { SyncTableKey } from "../core/types";
import type { TrackerSnapshot } from "./persist";

const deltasKey = (table: string, id: string): string => `${table}:${id}`;

/**
 * Registro de filas modificadas localmente y pendientes de subir.
 * Los repositorios marcan; el sync engine consume y limpia.
 *
 * Además guarda el delta acumulado de contadores (product_stocks.stock,
 * customers.balance) pendiente de subir. Sirve para reconciliar conflictos:
 * si la nube avanzó mientras había un cambio local sin sincronizar, se aplica
 * el delta local sobre el valor nuevo de la nube en lugar de pisarlo.
 */
export class ChangeTracker {
  private dirty = new Map<SyncTableKey, Set<string>>();
  private deltas = new Map<string, Record<string, number>>();
  onChange: (() => void) | null = null;

  mark(table: SyncTableKey, id: string): void {
    let ids = this.dirty.get(table);
    if (!ids) {
      ids = new Set();
      this.dirty.set(table, ids);
    }
    ids.add(id);
    this.onChange?.();
  }

  /** Acumula el cambio de un contador para una fila (se suma a lo pendiente). */
  recordDelta(table: SyncTableKey, id: string, values: Record<string, number>): void {
    if (!values || !Object.keys(values).length) return;
    const key = deltasKey(table, id);
    const current = this.deltas.get(key);
    const merged: Record<string, number> = { ...current };
    for (const [field, value] of Object.entries(values)) {
      if (typeof value !== "number" || !Number.isFinite(value) || value === 0) continue;
      merged[field] = (merged[field] ?? 0) + value;
    }
    if (Object.keys(merged).length) this.deltas.set(key, merged);
    else this.deltas.delete(key);
  }

  pendingDelta(table: SyncTableKey, id: string): Record<string, number> | undefined {
    return this.deltas.get(deltasKey(table, id));
  }

  clearDelta(table: SyncTableKey, id: string): void {
    this.deltas.delete(deltasKey(table, id));
  }

  /** null = tabla sin cambios; [] = marcada pero sin filas válidas. */
  takeIds(table: SyncTableKey): string[] | null {
    const ids = this.dirty.get(table);
    if (!ids) return null;
    return [...ids];
  }

  clear(table: SyncTableKey, ids: readonly string[]): void {
    const set = this.dirty.get(table);
    if (set) {
      ids.forEach((id) => set.delete(id));
      if (!set.size) this.dirty.delete(table);
    }
    ids.forEach((id) => this.clearDelta(table, id));
    this.onChange?.();
  }

  has(table: SyncTableKey): boolean {
    return (this.dirty.get(table)?.size ?? 0) > 0;
  }

  isDirty(table: SyncTableKey, id: string): boolean {
    return this.dirty.get(table)?.has(id) ?? false;
  }

  pendingCount(): number {
    let total = 0;
    this.dirty.forEach((ids) => {
      total += ids.size;
    });
    return total;
  }

  reset(): void {
    this.dirty.clear();
    this.deltas.clear();
    this.onChange?.();
  }

  snapshot(): TrackerSnapshot {
    const dirty: Partial<Record<SyncTableKey, string[]>> = {};
    this.dirty.forEach((ids, table) => {
      dirty[table] = [...ids];
    });
    const deltas: Record<string, Record<string, number>> = {};
    this.deltas.forEach((values, key) => {
      deltas[key] = { ...values };
    });
    return { dirty, deltas };
  }

  restore(snapshot: TrackerSnapshot | null): void {
    if (!snapshot) return;
    this.dirty.clear();
    this.deltas.clear();
    Object.entries(snapshot.dirty || {}).forEach(([table, ids]) => {
      if (!ids?.length) return;
      this.dirty.set(table as SyncTableKey, new Set(ids));
    });
    Object.entries(snapshot.deltas || {}).forEach(([key, values]) => {
      this.deltas.set(key, { ...values });
    });
    this.onChange?.();
  }
}
