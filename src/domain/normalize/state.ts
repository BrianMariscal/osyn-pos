import { z } from "zod";
import { normalizeQty } from "../../core/qty";
import { DEFAULT_BRANCH_ID, SETTINGS_ROW_ID } from "../../core/types";
import type {
  Branch,
  Customer,
  Expense,
  InventoryCount,
  Merma,
  MonthClosing,
  Product,
  ProductStock,
  Purchase,
  Sale,
  SaleReturn,
  Settings,
  Shift,
  Supplier
} from "../../core/types";
import { createInitialState, VIEW_ALL, type AppState } from "../app-state";
import { bool, iso, num, optionalPositive } from "./base";
import {
  branchSchema,
  customerSchema,
  expenseSchema,
  inventoryCountSchema,
  mermaSchema,
  monthClosingSchema,
  productSchema,
  productStockSchema,
  purchaseSchema,
  saleReturnSchema,
  saleSchema,
  settingsSchema,
  shiftSchema,
  supplierSchema
} from "./schemas";

const appStateSchema = z.object({
  settings: settingsSchema,
  branches: z.array(branchSchema).catch([]),
  suppliers: z.array(supplierSchema).catch([]),
  products: z.array(productSchema).catch([]),
  product_stocks: z.array(productStockSchema).catch([]),
  customers: z.array(customerSchema).catch([]),
  sales: z.array(saleSchema).catch([]),
  returns: z.array(saleReturnSchema).catch([]),
  expenses: z.array(expenseSchema).catch([]),
  purchases: z.array(purchaseSchema).catch([]),
  mermas: z.array(mermaSchema).catch([]),
  shifts: z.array(shiftSchema).catch([]),
  month_closings: z.array(monthClosingSchema).catch([]),
  inventory_counts: z.array(inventoryCountSchema).catch([]),
  cart: z
    .array(z.object({ productId: z.string().min(1), qty: num, promoPrice: optionalPositive, unit: z.enum(["pza", "caja"]).optional().catch(undefined) }))
    .catch([]),
  currentBranchId: z.string().catch(""),
  viewBranchId: z.string().catch(VIEW_ALL),
  sync: z
    .object({
      lastPulledAt: z.record(z.string()).catch({}),
      syncCursors: z.record(z.string()).catch({}),
      serverStock: bool.optional(),
      lastSyncAt: iso.nullable().catch(null),
      error: z.string().nullable().catch(null),
      pending: z.coerce.number().catch(0),
      syncing: z.coerce.boolean().catch(false)
    })
    .catch({ lastPulledAt: {}, syncCursors: {}, lastSyncAt: null, error: null, pending: 0, syncing: false })
});

/**
 * Valida y normaliza un snapshot desconocido (IndexedDB, importación JSON o
 * sync de la nube) hacia un AppState confiable. Cualquier campo inválido cae a
 * su default — nunca rompe el arranque.
 */
export function normalizeState(raw: unknown, settingsOverride?: Partial<Settings>): AppState {
  const parsed = appStateSchema.safeParse(raw);
  if (!parsed.success) return createInitialState(settingsOverride);
  const data = parsed.data;
  const settings: Settings = { ...data.settings, ...(settingsOverride ?? {}) };

  // Datos heredados: productos con stock pero sin filas de existencia por
  // sucursal. Se sintetizan en la sucursal por defecto para poder vender.
  let stocks = data.product_stocks as unknown as ProductStock[];
  if (!stocks.length) {
    stocks = data.products
      .filter((p) => p.id !== SETTINGS_ROW_ID && !p.deleted && normalizeQty((p as { stock?: number }).stock ?? 0) > 0)
      .map(
        (p): ProductStock => ({
          id: `${p.id}:${DEFAULT_BRANCH_ID}`,
          product_id: p.id,
          branch_id: DEFAULT_BRANCH_ID,
          stock: normalizeQty((p as { stock?: number }).stock ?? 0),
          min_stock: normalizeQty((p as { min_stock?: number }).min_stock ?? 0),
          updated_at: p.updated_at
        })
      );
  }

  return {
    settings,
    branches: data.branches as unknown as Branch[],
    suppliers: data.suppliers as unknown as Supplier[],
    products: data.products as unknown as Product[],
    product_stocks: stocks,
    customers: data.customers as unknown as Customer[],
    sales: data.sales as unknown as Sale[],
    returns: data.returns as unknown as SaleReturn[],
    expenses: data.expenses as unknown as Expense[],
    purchases: data.purchases as unknown as Purchase[],
    mermas: data.mermas as unknown as Merma[],
    shifts: data.shifts as unknown as Shift[],
    month_closings: data.month_closings as unknown as MonthClosing[],
    inventory_counts: data.inventory_counts as unknown as InventoryCount[],
    cart: data.cart,
    currentBranchId: data.currentBranchId,
    viewBranchId: data.viewBranchId || VIEW_ALL,
    sync: data.sync
  };
}
