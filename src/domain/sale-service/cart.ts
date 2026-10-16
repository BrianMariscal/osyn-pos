import { normalizeBulkQty, normalizeQty } from "../../core/qty";
import { isBulkUnit } from "../../core/units";
import type { CartLine, CartUnit } from "../../core/types";
import type { SaleDeps } from "./deps";
import { isLine, lineQty, unitOf } from "./lines";
import { availableFor, piecesPerUnit, sellsByPack } from "./stock";
import type { SimpleResult } from "./types";

export function addToCart(deps: SaleDeps, productId: string, qty = 1, promoPrice?: number, unit: CartUnit = "pza"): SimpleResult {
  const product = deps.repos.products.byId(productId);
  if (!product || product.active === false) return { ok: false, error: "Producto no disponible" };
  if (unit === "caja" && !sellsByPack(deps, productId)) return { ok: false, error: "Este producto no se vende por caja" };
  const available = availableFor(deps, productId, unit);
  const lines = deps.store.getState().cart;
  const line = lines.find((l) => isLine(l, productId, unit));
  const currentQty = line?.qty ?? 0;
  let newQty = lineQty(product, currentQty + qty);
  if (unit === "caja") newQty = Math.round(newQty);
  if (newQty <= 0) return { ok: false, error: "Cantidad inválida" };
  if (newQty > available) {
    if (available <= currentQty) {
      const branchName = deps.branches.name(deps.branches.operationalId());
      if (unit === "caja") return { ok: false, error: "No alcanza la existencia para una caja completa" };
      return { ok: false, error: available <= 0 ? `Sin existencia en ${branchName}` : "No hay más existencia" };
    }
    newQty = available;
  }
  // Una oferta tocada se conserva para todo el renglón (solo piezas).
  const promo = unit === "caja" ? undefined : promoPrice ?? line?.promoPrice;
  const built: CartLine = { productId, qty: newQty };
  if (promo !== undefined) built.promoPrice = promo;
  if (unit === "caja") built.unit = "caja";
  const next = line ? lines.map((l) => (isLine(l, productId, unit) ? built : l)) : [...lines, built];
  deps.store.update((state) => {
    state.cart = next;
  });
  return { ok: true };
}

export function setCartQty(deps: SaleDeps, productId: string, qty: number | string, unit: CartUnit = "pza"): SimpleResult {
  const lines = deps.store.getState().cart;
  if (!lines.some((l) => isLine(l, productId, unit))) return { ok: false, error: "No está en el carrito" };
  const product = deps.repos.products.byId(productId);
  // Piezas y cajas: enteros (fin de decimales raros como 1.03 en productos de
  // pieza). A granel: hasta 0.1 g/ml para que la venta por importe cuadre.
  const value =
    product?.um === "Pza" || unit === "caja"
      ? Math.round(normalizeQty(qty))
      : isBulkUnit(product?.um)
        ? normalizeBulkQty(qty)
        : normalizeQty(qty);
  if (value <= 0) {
    removeFromCart(deps, productId, unit);
    return { ok: true };
  }
  const available = availableFor(deps, productId, unit);
  if (value > available) {
    const capped = available > 0
      ? lines.map((l) => (isLine(l, productId, unit) ? { ...l, qty: available } : l))
      : lines.filter((l) => !isLine(l, productId, unit));
    deps.store.update((state) => {
      state.cart = capped;
    });
    return { ok: false, error: "No hay más existencia" };
  }
  const next = lines.map((l) => (isLine(l, productId, unit) ? { ...l, qty: value } : l));
  deps.store.update((state) => {
    state.cart = next;
  });
  return { ok: true };
}

export function setLineUnit(deps: SaleDeps, productId: string, from: CartUnit, to: CartUnit): SimpleResult {
  if (from === to) return { ok: true };
  const line = deps.store.getState().cart.find((l) => isLine(l, productId, from));
  if (!line) return { ok: false, error: "No está en el carrito" };
  if (to === "caja" && !sellsByPack(deps, productId)) return { ok: false, error: "Este producto no se vende por caja" };
  removeFromCart(deps, productId, from);
  const result = addToCart(deps, productId, to === "caja" ? 1 : piecesPerUnit(deps, productId, from) * line.qty, undefined, to);
  if (!result.ok) {
    // Sin existencia para la otra unidad: se deja como estaba.
    deps.store.update((state) => {
      state.cart = [...state.cart, line];
    });
  }
  return result;
}

export function removeFromCart(deps: SaleDeps, productId: string, unit?: CartUnit): void {
  deps.store.update((state) => {
    state.cart = state.cart.filter((line) => line.productId !== productId || (unit !== undefined && unitOf(line) !== unit));
  });
}

export function clearCart(deps: SaleDeps): void {
  deps.store.update((state) => {
    state.cart = [];
  });
}

export function purgeProduct(deps: SaleDeps, productId: string): void {
  if (deps.store.getState().cart.some((line) => line.productId === productId)) {
    removeFromCart(deps, productId);
  }
}
