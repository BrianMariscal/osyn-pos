import type { InventoryCount } from "../../core/types";

export interface ActiveCount {
  id: string;
  branch_id: string;
  started_at: string;
  items: Record<string, string>;
  /**
   * Existencia del sistema en el momento en que se capturó cada producto
   * (sin normalizar). Sirve para que una venta ocurrida después del conteo no
   * se confunda con un faltante.
   */
  baselines?: Record<string, number>;
}

export type ApplyCountResult = { ok: true; count: InventoryCount } | { ok: false; error: string };
export interface StockReceipt {
  productId: string;
  /** Cantidad en la unidad base del producto (piezas, kg…). */
  qty: number;
  totalPaid: number;
  /** Si se capturó en cajas: cuántas cajas y de cuántas piezas. */
  packs?: number;
  packSize?: number;
}
