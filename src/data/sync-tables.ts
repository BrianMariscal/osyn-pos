import { TAB_TABLES } from "../core/types";
import type { SyncTableKey } from "../core/types";

const SYNC_TABLES: readonly SyncTableKey[] = [
  "branches",
  "suppliers",
  "products",
  "product_stocks",
  "sales",
  // returns va antes de customers: la guardia del servidor solo acepta un
  // movimiento de devolución si ya existe la devolución a la que abona.
  "returns",
  "customers",
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

export function toSupabaseRow(table: SyncTableKey, row: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const column of SUPABASE_COLUMNS[table]) {
    out[column] = column === "data" ? row : (row[column] ?? null);
  }
  return out;
}

export function fromSupabaseRow(row: Record<string, unknown>): Record<string, unknown> {
  const data = row.data;
  const merged: Record<string, unknown> =
    data && typeof data === "object" ? { ...(data as Record<string, unknown>), ...row } : { ...row };
  delete merged.data;
  delete merged.synced_at;
  return merged;
}

function employeeTables(vendorTabs: readonly string[]): SyncTableKey[] {
  const tables = new Set<SyncTableKey>(["products", "product_stocks", "branches"]);
  vendorTabs.forEach((tab) => {
    (TAB_TABLES[tab as keyof typeof TAB_TABLES] ?? []).forEach((table) => tables.add(table));
  });
  return SYNC_TABLES.filter((table) => tables.has(table));
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
