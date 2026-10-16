import { normalizeQty } from "../../core/qty";
import type { Product } from "../../core/types";
import type { StockReceipt } from "../../domain/inventory-service";

export type LineMode = "pza" | "caja";

export interface LineState {
  productId: string;
  mode: LineMode;
  qty: string;
  total: string;
  /** Texto del buscador de producto de la línea. */
  search: string;
  /** Sugerencias visibles mientras se escribe. */
  open: boolean;
}

export interface PurchaseLinesOptions {
  /** true: el total pagado es obligatorio (compras); false: opcional (entradas). */
  requireTotal: boolean;
  /** Proveedor elegido: sus productos se listan primero. */
  supplierId?: () => string;
}

export interface PurchaseLines {
  render(): void;
  reset(): void;
  addLine(): void;
  read(): { ok: true; items: StockReceipt[] } | { ok: false; error: string };
}

export function packSizeOf(product: Product | undefined): number {
  const size = normalizeQty(product?.pack_size ?? 0);
  return size > 1 ? size : 0;
}
