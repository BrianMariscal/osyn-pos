import { normalizeQty, roundQty4 } from "../../core/qty";
import { isBulkUnit } from "../../core/units";
import type { CartLine, CartUnit, ProductStock } from "../../core/types";
import type { SaleDeps } from "./deps";
import { lineQty, unitOf } from "./lines";

function stockRow(deps: SaleDeps, productId: string): ProductStock | undefined {
  const branchId = deps.branches.operationalId();
  return deps.repos.stocks.all().find((row) => !row.deleted && row.product_id === productId && row.branch_id === branchId);
}

export function stockOf(deps: SaleDeps, productId: string): number {
  const row = stockRow(deps, productId);
  if (!row) return 0;
  const stock = Number(row.stock);
  return Number.isFinite(stock) && stock > 0 ? roundQty4(stock) : 0;
}

export function minStockOf(deps: SaleDeps, productId: string): number {
  const row = stockRow(deps, productId);
  if (!row) return 0;
  const min = Number(row.min_stock);
  return Number.isFinite(min) && min > 0 ? roundQty4(min) : 0;
}

export function sellsByPack(deps: SaleDeps, productId: string): boolean {
  const product = deps.repos.products.byId(productId);
  return Boolean(product && (product.pack_size ?? 0) > 1 && (product.pack_price ?? 0) > 0);
}

export function piecesPerUnit(deps: SaleDeps, productId: string, unit: CartUnit = "pza"): number {
  if (unit !== "caja") return 1;
  return Math.max(1, Math.round(deps.repos.products.byId(productId)?.pack_size ?? 1));
}

export function unitPrice(deps: SaleDeps, line: CartLine): number {
  const product = deps.repos.products.byId(line.productId);
  if (!product) return 0;
  if (line.unit === "caja") return product.pack_price ?? 0;
  const promo = line.promoPrice;
  return promo !== undefined && promo > 0 && promo >= product.cost && promo < product.price ? promo : product.price;
}

export function availableFor(deps: SaleDeps, productId: string, unit: CartUnit = "pza"): number {
  const product = deps.repos.products.byId(productId);
  const others = deps.store
    .getState()
    .cart.filter((l) => l.productId === productId && unitOf(l) !== unit)
    .reduce((sum, l) => sum + lineQty(product, l.qty) * piecesPerUnit(deps, productId, unitOf(l)), 0);
  const free = Math.max(0, roundQty4(stockOf(deps, productId) - others));
  if (unit === "caja") return Math.floor(free / piecesPerUnit(deps, productId, "caja"));
  return isBulkUnit(product?.um) ? free : normalizeQty(free);
}
