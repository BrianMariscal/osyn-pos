import { roundQty4 } from "../core/qty";
import type { ProductStock } from "../core/types";
import type { Repositories } from "../data/repositories";

/**
 * Mueve la existencia de un producto en una sucursal por una venta, compra,
 * devolución o merma. Con `serverStock` el servidor aplica el mismo movimiento
 * al recibir el registro, así que aquí solo se refleja en pantalla (no se sube
 * la fila; si se subiera, el stock se descontaría dos veces).
 *
 * La existencia se guarda con precisión de 0.1 g/ml (4 decimales) para no
 * perder los gramos de una venta a granel.
 */
export function moveStock(
  repos: Repositories,
  serverStock: boolean,
  productId: string,
  branchId: string,
  delta: number,
  ts: string
): void {
  const row = repos.stocks.list().find((r) => r.product_id === productId && r.branch_id === branchId);
  if (!row && delta <= 0) return;
  const next: ProductStock = row
    ? { ...row, stock: Math.max(0, roundQty4(Number(row.stock) + delta)), updated_at: ts }
    : { id: `${productId}:${branchId}`, product_id: productId, branch_id: branchId, stock: Math.max(0, roundQty4(delta)), min_stock: 0, updated_at: ts };
  if (serverStock) repos.stocks.applyLocal(next);
  else repos.stocks.upsert(next);
}
