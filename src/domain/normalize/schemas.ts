import { z } from "zod";
import { DEFAULT_ADMIN_TABS, DEFAULT_VENDOR_TABS, MERMA_REASONS, PAYMENT_METHODS, REFUND_METHODS } from "../../core/types";
import { bool, iso, num, optionalNonNegative, optionalPositive, optionalString, saleGroupSchema, unitSchema } from "./base";
import { adminTabsSchema, tabsSchema } from "./tabs";

export const settingsSchema = z.object({
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

export const branchSchema = z.object({
  id: z.string().min(1),
  name: z.string().catch(""),
  address: z.string().catch(""),
  active: bool,
  whatsapp1: optionalString,
  whatsapp2: optionalString,
  auto_close: bool.optional(),
  created_at: iso.optional(),
  updated_at: iso,
  deleted: bool.optional()
});

export const productSchema = z.object({
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

export const productStockSchema = z.object({
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

export const customerSchema = z.object({
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

export const saleSchema = z.object({
  id: z.string().min(1),
  branch_id: z.string().catch(""),
  items: z.array(saleItemSchema).catch([]),
  total: num,
  cost: num,
  profit: num,
  payment: z.enum(PAYMENT_METHODS as unknown as [string, ...string[]]).catch("efectivo"),
  customer_id: z.string().nullable().catch(null),
  // Datos del cobro: si el esquema no los declara, Zod los tira en cada
  // recarga y el ticket pierde "Pagó con", "Cambio" y quién atendió.
  cash_received: optionalPositive,
  change: optionalNonNegative,
  cashier: optionalString,
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

export const saleReturnSchema = z.object({
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

export const expenseSchema = z.object({
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

export const purchaseSchema = z.object({
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

export const shiftSchema = z.object({
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

export const monthClosingSchema = z.object({
  id: z.string().min(1),
  branch_id: z.string().catch(""),
  month: z.string().catch(""),
  report: reportSchema,
  closed_at: iso,
  updated_at: iso,
  deleted: bool.optional()
});

export const inventoryCountSchema = z.object({
  id: z.string().min(1),
  branch_id: z.string().catch(""),
  started_at: iso,
  applied_at: iso,
  summary: z.record(z.unknown()).catch({}),
  incidences: z.array(z.record(z.unknown())).catch([]),
  updated_at: iso,
  deleted: bool.optional()
});

export const supplierSchema = z.object({
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

export const mermaSchema = z.object({
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
