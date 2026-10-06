import { normalizeQty } from "../core/qty";
import type { ProductStock } from "../core/types";
import type { Repositories } from "../data/repositories";

/**
 * Mueve la existencia de un producto en una sucursal por una venta, compra o
 * merma. Con `serverStock` el servidor aplica el mismo movimiento al recibir el
 * registro, así que aquí solo se refleja en pantalla (no se sube la fila; si se
 * subiera, el stock se descontaría dos veces).
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
    ? { ...row, stock: normalizeQty(normalizeQty(row.stock) + delta), updated_at: ts }
    : { id: `${productId}:${branchId}`, product_id: productId, branch_id: branchId, stock: normalizeQty(delta), min_stock: 0, updated_at: ts };
  if (serverStock) repos.stocks.applyLocal(next);
  else repos.stocks.upsert(next);
}
