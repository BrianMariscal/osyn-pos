import type { CartLine, CartUnit } from "../../core/types";
import type { Repositories } from "../../data/repositories";
import type { AppState } from "../app-state";
import type { BranchService } from "../branch-service";
import type { Store } from "../store";
import { addToCart, clearCart, purgeProduct, removeFromCart, setCartQty, setLineUnit } from "./cart";
import { completeSale } from "./checkout";
import type { SaleDeps } from "./deps";
import { availableFor, minStockOf, piecesPerUnit, sellsByPack, stockOf, unitPrice } from "./stock";
import type { CompleteSaleInput, CompleteSaleResult, SimpleResult } from "./types";

/**
 * Venta: el carrito solo guarda { productId, qty }. Precio y costo se resuelven
 * AL COBRAR (así el precio siempre es el vigente) y todo el dinero se suma en
 * centavos enteros.
 */
export class SaleService {
  constructor(
    private store: Store<AppState>,
    private repos: Repositories,
    private branches: BranchService
  ) {}

  private get deps(): SaleDeps {
    return { store: this.store, repos: this.repos, branches: this.branches };
  }

  cart(): CartLine[] {
    return this.store.getState().cart;
  }

  stockOf(productId: string): number {
    return stockOf(this.deps, productId);
  }

  minStockOf(productId: string): number {
    return minStockOf(this.deps, productId);
  }

  /** ¿El producto se vende también por caja? (piezas por caja y precio de caja). */
  sellsByPack(productId: string): boolean {
    return sellsByPack(this.deps, productId);
  }

  /** Piezas que ocupa una unidad del renglón (1 o las piezas de la caja). */
  piecesPerUnit(productId: string, unit: CartUnit = "pza"): number {
    return piecesPerUnit(this.deps, productId, unit);
  }

  /** Precio que se cobra por una línea: caja, oferta (si no baja del costo) o normal. */
  unitPrice(line: CartLine): number {
    return unitPrice(this.deps, line);
  }

  /** Cuántas unidades (piezas o cajas) caben en la existencia, sin contar ese renglón. */
  availableFor(productId: string, unit: CartUnit = "pza"): number {
    return availableFor(this.deps, productId, unit);
  }

  addToCart(productId: string, qty = 1, promoPrice?: number, unit: CartUnit = "pza"): SimpleResult {
    return addToCart(this.deps, productId, qty, promoPrice, unit);
  }

  setCartQty(productId: string, qty: number | string, unit: CartUnit = "pza"): SimpleResult {
    return setCartQty(this.deps, productId, qty, unit);
  }

  /** Cambia un renglón entre pieza y caja (se suma si ya había uno en la otra unidad). */
  setLineUnit(productId: string, from: CartUnit, to: CartUnit): SimpleResult {
    return setLineUnit(this.deps, productId, from, to);
  }

  removeFromCart(productId: string, unit?: CartUnit): void {
    removeFromCart(this.deps, productId, unit);
  }

  clearCart(): void {
    clearCart(this.deps);
  }

  /** Quita del carrito un producto eliminado (evita el carrito roto). */
  purgeProduct(productId: string): void {
    purgeProduct(this.deps, productId);
  }

  completeSale(input: CompleteSaleInput): CompleteSaleResult {
    return completeSale(this.deps, input);
  }
}
