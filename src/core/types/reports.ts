import type { Unit } from "./base";

export interface ShiftSummary {
  /** Ventas del turno, netas de devoluciones. */
  ventas: number;
  /** Cobrado por ventas en efectivo, neto de lo reembolsado en efectivo. */
  efectivo: number;
  /** Ventas por transferencia, netas de lo reembolsado por esa vía. */
  transferencia: number;
  /** Ventas con tarjeta, netas de lo reembolsado por esa vía. */
  tarjeta: number;
  /** Ventas fiadas, netas de lo reembolsado como abono a fiado. */
  fiado: number;
  /** Abonos de fiado cobrados en efectivo en el turno (entran a la caja). */
  abonos?: number;
  /** Ventas de cigarros y de cerveza, netas (incluidas en `ventas`). */
  cigarros?: number;
  cerveza?: number;
  /** Consumo interno de la tienda, valuado a costo (NO incluido en `ventas`). */
  interno?: number;
  /** Devoluciones del turno (todas las formas de reembolso). Ya restadas de `ventas`. */
  devoluciones?: number;
  /** Devoluciones reembolsadas EN EFECTIVO (ya restadas de `efectivo`). */
  devolucionesEfectivo?: number;
  gastos: number;
  proveedores: number;
  mermas: number;
  /** Compras pagadas con dinero aparte (no salen de la caja). Opcional en cortes viejos. */
  proveedoresAparte?: number;
  ganancia: number;
  efectivoEsperado: number;
}

export interface Shift {
  id: string;
  branch_id: string;
  summary: ShiftSummary;
  opening_cash: number;
  counted_cash: number;
  withdrawn_cash: number;
  next_opening_cash: number;
  expected_cash_with_base: number;
  difference: number;
  distribution_difference: number;
  notes: string;
  closed_at: string;
  updated_at: string;
  deleted?: boolean;
}

export interface ProductSaleStat {
  id: string;
  name: string;
  qty: number;
  total: number;
  um: Unit;
}

export interface PeriodReport {
  start: string;
  end: string;
  branch_id: string | "all";
  /** Ventas del periodo ya netas de devoluciones (importe restado). */
  sales_total: number;
  /** Costo de lo vendido ya neto de devoluciones (su costo restado). */
  sales_cost: number;
  gross_profit: number;
  /** Gastos totales del periodo = costos fijos prorrateados + gastos extra. */
  expenses_total: number;
  fixed_costs_total?: number;
  extra_expenses_total?: number;
  cigarros_total?: number;
  cerveza_total?: number;
  internal_total?: number;
  purchases_total: number;
  mermas_total: number;
  mermas_count: number;
  /** Devoluciones del periodo: importe reembolsado y su costo (ya restados de ventas y costo). */
  returns_total?: number;
  returns_cost?: number;
  returns_count?: number;
  profit_after_expenses: number;
  credit_total: number;
  sales_count: number;
  expenses_count: number;
  purchases_count: number;
  top_products: ProductSaleStat[];
  slow_products: ProductSaleStat[];
}

export interface MonthClosing {
  id: string;
  branch_id: string;
  month: string;
  report: PeriodReport;
  closed_at: string;
  updated_at: string;
  deleted?: boolean;
}

export interface CountIncidence {
  product_id: string;
  name: string;
  category: string;
  um: Unit;
  system_stock: number;
  physical_stock: number;
  difference: number;
  cost_impact: number;
  sale_impact: number;
}

export interface CountSummary {
  captured: number;
  ok: number;
  shortage: number;
  surplus: number;
  adjusted: number;
  costImpact: number;
  saleImpact: number;
  incidences: CountIncidence[];
}

export interface InventoryCount {
  id: string;
  branch_id: string;
  started_at: string;
  applied_at: string;
  summary: CountSummary;
  incidences: CountIncidence[];
  updated_at: string;
  deleted?: boolean;
}
