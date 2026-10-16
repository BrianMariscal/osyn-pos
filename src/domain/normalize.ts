import { z } from "zod";
import { DEFAULT_BRANCH_ID, MERMA_REASONS, PAYMENT_METHODS, REFUND_METHODS, SALE_GROUPS, SETTINGS_ROW_ID, UNITS } from "../core/types";
import type {
  Branch,
  Customer,
  Expense,
  InventoryCount,
  MonthClosing,
  Product,
  ProductStock,
  Purchase,
  Sale,
  SaleReturn,
  Settings,
  Shift,
  TabId,
  Unit
} from "../core/types";
import { ALL_TABS, DEFAULT_ADMIN_TABS, DEFAULT_VENDOR_TABS, VENDOR_CONFIGURABLE_TABS } from "../core/types";
import { createInitialState, VIEW_ALL, type AppState } from "./app-state";
import { normalizeQty } from "../core/qty";
import type { Merma, Supplier } from "../core/types";

const iso = z.string().catch("");
const num = z.coerce.number().catch(0);
const bool = z.coerce.boolean().catch(false);

/** Opcional que tolera basura: valor inválido → undefined (nunca rompe el arranque). */
const optionalString = z.string().optional().catch(undefined);
const optionalPositive = z.coerce.number().positive().optional().catch(undefined);
const saleGroupSchema = z.enum(SALE_GROUPS as unknown as [string, ...string[]]).optional().catch(undefined);

const unitSchema = z
  .string()
  .catch("Pza")
  .transform((value): Unit => ((UNITS as readonly string[]).includes(value) ? (value as Unit) : "Pza"));

/**
 * Normaliza la lista de pestañas del vendedor y migra el default antiguo
 * ("venta,fiado") al nuevo default amplio — los dispositivos que guardaron el
 * valor de fábrica viejo quedan actualizados sin tocar la nube.
 */
export function normalizeVendorTabs(values: unknown): TabId[] {
  const valid = Array.isArray(values)
    ? values.filter((v): v is TabId => typeof v === "string" && (VENDOR_CONFIGURABLE_TABS as readonly string[]).includes(v))
    : [];
  if (!valid.length) return [...DEFAULT_VENDOR_TABS];
  const oldDefault = valid.length === 2 && valid.every((v) => v === "venta" || v === "fiado");
  return oldDefault ? [...DEFAULT_VENDOR_TABS] : valid;
}

const tabsSchema = z
  .array(z.string())
  .catch([])
  .transform(normalizeVendorTabs);

/** Pestañas del administrador: solo las válidas; si no hay ninguna, todas. */
export function normalizeManagerTabs(values: unknown): TabId[] {
  const valid = Array.isArray(values)
    ? values.filter((v): v is TabId => typeof v === "string" && (ALL_TABS as readonly string[]).includes(v))
    : [];
  return valid.length ? valid : [...DEFAULT_ADMIN_TABS];
}

const adminTabsSchema = z
  .array(z.string())
  .catch([])
  .transform(normalizeManagerTabs);

const settingsSchema = z.object({
  storeName: z.string().catch("Mi tienda"),
  logo: z.string().catch(""),
  whatsappNumber: z.string().catch(""),
  whatsapp2: z.string().catch(""),
  whatsapp3: z.string().catch(""),
  vendorTabs: tabsSchema.default([...DEFAULT_VENDOR_TABS]),
  adminTabs: adminTabsSchema.default([...DEFAULT_ADMIN_TABS]),
  assistantVoiceEnabled: bool,
  theme: z.enum(["auto", "light", "dark"]).catch("auto"),
  updated_at: iso
});

const branchSchema = z.object({
  id: z.string().min(1),
  name: z.string().catch(""),
  address: z.string().catch(""),
  active: bool,
  created_at: iso.optional(),
  updated_at: iso,
  deleted: bool.optional()
});

const productSchema = z.object({
  id: z.string().min(1),
  name: z.string().catch(""),
  category: z.string().catch(""),
  um: unitSchema,
  cost: num,
  price: num,
  stock: num.optional(),
  min_stock: num.optional(),
  barcode: z.string().optional(),
  supplier_id: optionalString,
  pack_size: optionalPositive,
  pack_price: optionalPositive,
  sale_group: saleGroupSchema,
  active: bool,
  seed_example: bool.optional(),
  created_at: iso.optional(),
  updated_at: iso,
  deleted: bool.optional()
});

const productStockSchema = z.object({
  id: z.string().min(1),
  product_id: z.string().min(1),
  branch_id: z.string().min(1),
  stock: num,
  min_stock: num,
  updated_at: iso,
  deleted: bool.optional()
});

const movementSchema = z.object({
  id: z.string().min(1),
  type: z.enum(["cargo", "pago", "devolucion"]).catch("cargo"),
  amount: num,
  note: z.string().catch(""),
  sale_id: optionalString,
  return_id: optionalString,
  created_at: iso
});

const customerSchema = z.object({
  id: z.string().min(1),
  branch_id: z.string().catch(""),
  name: z.string().catch(""),
  phone: z.string().catch(""),
  notes: z.string().catch(""),
  balance: num,
  movements: z.array(movementSchema).catch([]),
  created_at: iso,
  updated_at: iso,
  deleted: bool.optional()
});

const saleItemSchema = z.object({
  productId: z.string().min(1),
  name: z.string().catch(""),
  qty: num,
  price: num,
  cost: num,
  um: unitSchema,
  group: saleGroupSchema,
  regular_price: optionalPositive,
  pack_size: optionalPositive
});

const saleSchema = z.object({
  id: z.string().min(1),
  branch_id: z.string().catch(""),
  items: z.array(saleItemSchema).catch([]),
  total: num,
  cost: num,
  profit: num,
  payment: z.enum(PAYMENT_METHODS as unknown as [string, ...string[]]).catch("efectivo"),
  customer_id: z.string().nullable().catch(null),
  stock_by_server: bool.optional(),
  created_at: iso,
  updated_at: iso,
  deleted: bool.optional()
});

const saleReturnItemSchema = z.object({
  index: num,
  productId: z.string().catch(""),
  name: z.string().catch(""),
  qty: num,
  price: num,
  cost: num,
  um: unitSchema,
  pack_size: optionalPositive,
  group: saleGroupSchema
});

const saleReturnSchema = z.object({
  id: z.string().min(1),
  branch_id: z.string().catch(""),
  sale_id: z.string().catch(""),
  folio: z.string().catch(""),
  items: z.array(saleReturnItemSchema).catch([]),
  total: num,
  cost: num,
  payment: z.enum(REFUND_METHODS as unknown as [string, ...string[]]).catch("efectivo"),
  customer_id: z.string().nullable().catch(null),
  reason: z.string().catch(""),
  note: z.string().catch(""),
  cashier: optionalString,
  stock_by_server: bool.optional(),
  created_at: iso,
  updated_at: iso,
  deleted: bool.optional()
});

const expenseSchema = z.object({
  id: z.string().min(1),
  branch_id: z.string().catch(""),
  concept: z.string().catch(""),
  amount: num,
  category: z.string().catch("Varios"),
  kind: z.enum(["fijo", "extra"]).optional().catch(undefined),
  period: z.enum(["semanal", "mensual"]).optional().catch(undefined),
  created_at: iso,
  updated_at: iso,
  deleted: bool.optional()
});

const purchaseSchema = z.object({
  id: z.string().min(1),
  branch_id: z.string().catch(""),
  supplier: z.string().catch(""),
  product_id: z.string().catch(""),
  product_name: z.string().catch(""),
  um: unitSchema,
  qty: num,
  total: num,
  packs: optionalPositive,
  pack_size: optionalPositive,
  paid_from: z.enum(["caja", "aparte"]).optional().catch(undefined),
  stock_by_server: bool.optional(),
  created_at: iso,
  updated_at: iso,
  deleted: bool.optional()
});

const shiftSchema = z.object({
  id: z.string().min(1),
  branch_id: z.string().catch(""),
  summary: z.record(z.unknown()).catch({}),
  opening_cash: num,
  counted_cash: num,
  withdrawn_cash: num,
  next_opening_cash: num,
  expected_cash_with_base: num,
  difference: num,
  distribution_difference: num,
  notes: z.string().catch(""),
  closed_at: iso,
  updated_at: iso,
  deleted: bool.optional()
});

const reportSchema = z.record(z.unknown()).catch({});

const monthClosingSchema = z.object({
  id: z.string().min(1),
  branch_id: z.string().catch(""),
  month: z.string().catch(""),
  report: reportSchema,
  closed_at: iso,
  updated_at: iso,
  deleted: bool.optional()
});

const inventoryCountSchema = z.object({
  id: z.string().min(1),
  branch_id: z.string().catch(""),
  started_at: iso,
  applied_at: iso,
  summary: z.record(z.unknown()).catch({}),
  incidences: z.array(z.record(z.unknown())).catch([]),
  updated_at: iso,
  deleted: bool.optional()
});

const supplierSchema = z.object({
  id: z.string().min(1),
  number: optionalPositive,
  name: z.string().catch(""),
  type: z.string().catch(""),
  phone: z.string().catch(""),
  notes: z.string().catch(""),
  created_at: iso.optional(),
  updated_at: iso,
  deleted: bool.optional()
});

const mermaSchema = z.object({
  id: z.string().min(1),
  branch_id: z.string().catch(""),
  product_id: z.string().catch(""),
  product_name: z.string().catch(""),
  um: unitSchema,
  qty: num,
  reason: z.enum(MERMA_REASONS).catch("Otro"),
  note: z.string().catch(""),
  cost_impact: num,
  stock_by_server: bool.optional(),
  created_at: iso,
  updated_at: iso,
  deleted: bool.optional()
});

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
