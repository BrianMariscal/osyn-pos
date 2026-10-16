import type { Unit } from "./base";

/**
 * "fijo": costo fijo MENSUAL (renta, luz, sueldos) que se reparte por día.
 * "extra" (o sin valor, datos anteriores): gasto pagado de la caja en el momento.
 */
export type ExpenseKind = "fijo" | "extra";
/** Frecuencia de un costo fijo. Sin valor = mensual (datos anteriores). */
export type ExpensePeriod = "semanal" | "mensual";

export interface Expense {
  id: string;
  branch_id: string;
  concept: string;
  /** Fijo: monto mensual. Extra: monto pagado. */
  amount: number;
  category: string;
  kind?: ExpenseKind;
  period?: ExpensePeriod;
  created_at: string;
  updated_at: string;
  deleted?: boolean;
}

export interface Purchase {
  id: string;
  branch_id: string;
  supplier: string;
  product_id: string;
  product_name: string;
  um: Unit;
  qty: number;
  total: number;
  /** Cajas capturadas y piezas por caja (si la compra se capturó en cajas). */
  packs?: number;
  pack_size?: number;
  /** "aparte": pagada con dinero fuera de la caja (Central de Abastos); no se resta en el corte. */
  paid_from?: PurchasePayment;
  stock_by_server?: boolean;
  created_at: string;
  updated_at: string;
  deleted?: boolean;
}

export type PurchasePayment = "caja" | "aparte";

export const MERMA_REASONS = ["Caducado", "Dañado", "Roto", "Vencido", "Otro"] as const;
export type MermaReason = (typeof MERMA_REASONS)[number];

/** Merma: pérdida de producto sin venta (caducado, dañado, roto). */
export interface Merma {
  id: string;
  branch_id: string;
  product_id: string;
  product_name: string;
  um: Unit;
  qty: number;
  reason: MermaReason;
  note: string;
  cost_impact: number;
  stock_by_server?: boolean;
  created_at: string;
  updated_at: string;
  deleted?: boolean;
}

export const EXPENSE_CATEGORIES = ["Renta", "Luz", "Agua", "Sueldos", "Transporte", "Varios"] as const;
