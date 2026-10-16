import { normalizeQtyForUnit } from "../../core/units";
import type { Product } from "../../core/types";
import { unitsFromPacks } from "../../domain/inventory-service";
import type { AppContext } from "../context";
import { packSizeOf, type LineState } from "./types";

/** Productos activos en orden alfabético. */
export function activeProducts(ctx: AppContext): Product[] {
  return ctx.repos.products
    .list()
    .filter((product) => product.active !== false)
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** Cantidad capturada en unidad base (cajas → piezas, a granel → normalizada). */
export function baseQty(ctx: AppContext, line: LineState): number {
  const product = ctx.repos.products.byId(line.productId);
  const qty = Number(line.qty || 0);
  if (!Number.isFinite(qty) || qty <= 0) return 0;
  return line.mode === "caja" ? unitsFromPacks(qty, packSizeOf(product)) : normalizeQtyForUnit(qty, product?.um);
}

/** Elige el producto de una línea; con caja, se captura en cajas por defecto. */
export function chooseProduct(line: LineState, product: Product | undefined): void {
  line.productId = product?.id ?? "";
  line.mode = packSizeOf(product) ? "caja" : "pza";
}
