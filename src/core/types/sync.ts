export type SyncTableKey =
  | "branches"
  | "suppliers"
  | "products"
  | "product_stocks"
  | "customers"
  | "sales"
  | "returns"
  | "expenses"
  | "purchases"
  | "mermas"
  | "shifts"
  | "month_closings"
  | "inventory_counts";

export interface SyncState {
  lastPulledAt: Partial<Record<SyncTableKey, string>>;
  /** Mayor synced_at (reloj del servidor) leído por tabla. */
  syncCursors: Partial<Record<SyncTableKey, string>>;
  /** El servidor ya lleva el stock (migración stock-servidor aplicada). */
  serverStock?: boolean;
  lastSyncAt: string | null;
  error: string | null;
  pending: number;
  syncing: boolean;
}
