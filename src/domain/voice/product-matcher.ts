import { normalizeQty } from "../../core/qty";
import type { Product } from "../../core/types";
import { normalizeVoiceText } from "./voice-parser";

/** Coincidencia difusa producto ↔ orden dictada (score por palabras). */
export function voiceMatchScore(needle: string, haystack: string): number {
  if (!needle) return 0;
  if (haystack.includes(needle)) return 100 + needle.length;
  return needle.split(" ").filter((word) => {
    if (word.length <= 1) return false;
    const singular = word.replace(/s$/, "");
    return haystack.includes(word) || haystack.includes(singular);
  }).length;
}

export function findProductByVoice(
  query: string,
  products: Product[]
): Product | undefined {
  const needle = normalizeVoiceText(query);
  if (!needle) return undefined;
  const sellable = products.filter((product) => product.active !== false && !product.deleted);
  let best: Product | undefined;
  let bestScore = 0;
  for (const product of sellable) {
    const haystack = normalizeVoiceText(`${product.name} ${product.category || ""}`);
    const score = voiceMatchScore(needle, haystack);
    if (score > bestScore) {
      best = product;
      bestScore = score;
    }
  }
  return bestScore >= 1 ? best : undefined;
}

export function findProductByBarcode(products: Product[], code: string): Product | undefined {
  const clean = code.trim();
  if (!clean) return undefined;
  return products.find(
    (product) => product.barcode && product.barcode.trim() === clean && product.active !== false && !product.deleted
  );
}

export interface MatchedOrder {
  product: Product;
  qty: number;
}

export interface OrderMatchResult {
  matched: MatchedOrder[];
  notFound: string[];
}

/** Resuelve órdenes (locales o de la IA) contra el catálogo real. */
export function matchOrdersToProducts(orders: Array<{ product_id?: string; name?: string; qty?: number }>, products: Product[]): OrderMatchResult {
  const matched: MatchedOrder[] = [];
  const notFound: string[] = [];
  for (const order of orders) {
    const qty = normalizeQty(order.qty ?? 1);
    if (qty <= 0) continue;
    let product: Product | undefined;
    if (order.product_id) {
      const exact = products.find((p) => p.id === order.product_id && p.active !== false);
      if (exact) product = exact;
    }
    product = product ?? findProductByVoice(order.name ?? order.product_id ?? "", products);
    if (product) matched.push({ product, qty });
    else notFound.push(order.name || order.product_id || "producto");
  }
  return { matched, notFound };
}
