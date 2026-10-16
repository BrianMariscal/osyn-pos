import { normalizeBulkQty, normalizeQty } from "../../core/qty";
import { isBulkUnit } from "../../core/units";
import type { CartLine, CartUnit, Product } from "../../core/types";

export function unitOf(line: CartLine): CartUnit {
  return line.unit === "caja" ? "caja" : "pza";
}

export function isLine(line: CartLine, productId: string, unit: CartUnit): boolean {
  return line.productId === productId && unitOf(line) === unit;
}

/**
 * Normaliza la cantidad de un renglón según el producto: piezas enteras, a
 * granel hasta 0.1 g/ml (venta por peso/importe) y el resto a 2 decimales.
 */
export function lineQty(product: Product | undefined, qty: number | string): number {
  if (isBulkUnit(product?.um)) return normalizeBulkQty(qty);
  return normalizeQty(qty);
}
