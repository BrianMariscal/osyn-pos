import { nowISO } from "../core/dates";
import { uid } from "../core/id";
import { lineTotalCents, sumCents, toPesos } from "../core/money";
import { normalizeQty } from "../core/qty";
import type { CartLine, PaymentMethod, ProductStock, Sale, SaleItem } from "../core/types";
import type { Repositories } from "../data/repositories";
import type { BranchService } from "./branch-service";
import type { AppState } from "./app-state";
import type { Store } from "./store";

export interface CompleteSaleInput {
  payment: PaymentMethod;
  customerId: string | null;
}

export type CompleteSaleResult = { ok: true; sale: Sale } | { ok: false; error: string };

export type SimpleResult = { ok: true } | { ok: false; error: string };

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

  cart(): CartLine[] {
    return this.store.getState().cart;
  }

  stockOf(productId: string): number {
    const row = this.stockRow(productId);
    return row ? normalizeQty(row.stock) : 0;
  }

  minStockOf(productId: string): number {
    const row = this.stockRow(productId);
    return row ? normalizeQty(row.min_stock) : 0;
  }

  addToCart(productId: string, qty = 1): SimpleResult {
    const product = this.repos.products.byId(productId);
    if (!product || product.active === false) return { ok: false, error: "Producto no disponible" };
    const available = this.stockOf(productId);
    const lines = this.store.getState().cart;
    const line = lines.find((l) => l.productId === productId);
    const currentQty = line?.qty ?? 0;
    let newQty = normalizeQty(currentQty + normalizeQty(qty));
    if (newQty <= 0) return { ok: false, error: "Cantidad inválida" };
    if (newQty > available) {
      if (available <= currentQty) {
        const branchName = this.branches.name(this.branches.operationalId());
        return { ok: false, error: available <= 0 ? `Sin existencia en ${branchName}` : "No hay más existencia" };
      }
      newQty = available;
    }
    const next = line
      ? lines.map((l) => (l.productId === productId ? { ...l, qty: newQty } : l))
      : [...lines, { productId, qty: newQty } as CartLine];
    this.store.update((state) => {
      state.cart = next;
    });
    return { ok: true };
  }

  setCartQty(productId: string, qty: number | string): SimpleResult {
    const lines = this.store.getState().cart;
    if (!lines.some((l) => l.productId === productId)) return { ok: false, error: "No está en el carrito" };
    const product = this.repos.products.byId(productId);
    // Piezas: solo enteros (fin de decimales raros como 1.03 en productos de pieza)
    const value = product?.um === "Pza" ? Math.round(normalizeQty(qty)) : normalizeQty(qty);
    if (value <= 0) {
      this.removeFromCart(productId);
      return { ok: true };
    }
    const available = this.stockOf(productId);
    if (value > available) {
      const capped = lines.map((l) => (l.productId === productId ? { ...l, qty: available } : l));
      this.store.update((state) => {
        state.cart = capped;
      });
      return { ok: false, error: "No hay más existencia" };
    }
    const next = lines.map((l) => (l.productId === productId ? { ...l, qty: value } : l));
    this.store.update((state) => {
      state.cart = next;
    });
    return { ok: true };
  }

  removeFromCart(productId: string): void {
    this.store.update((state) => {
      state.cart = state.cart.filter((line) => line.productId !== productId);
    });
  }

  clearCart(): void {
    this.store.update((state) => {
      state.cart = [];
    });
  }

  /** Quita del carrito un producto eliminado (evita el carrito roto). */
  purgeProduct(productId: string): void {
    if (this.store.getState().cart.some((line) => line.productId === productId)) {
      this.removeFromCart(productId);
    }
  }

  completeSale(input: CompleteSaleInput): CompleteSaleResult {
    const branchId = this.branches.operationalId();
    const cart = this.store.getState().cart;
    if (!cart.length) return { ok: false, error: "El carrito está vacío" };
    const items: SaleItem[] = [];
    for (const line of cart) {
      const product = this.repos.products.byId(line.productId);
      if (!product) return { ok: false, error: "Un producto del carrito ya no existe" };
      const qty = normalizeQty(line.qty);
      const available = this.stockOf(line.productId);
      if (qty <= 0 || qty > available) return { ok: false, error: "Revisa cantidades y existencia" };
      items.push({ productId: product.id, name: product.name, qty, price: product.price, cost: product.cost, um: product.um });
    }
    if (input.payment === "fiado" && !input.customerId) return { ok: false, error: "Selecciona cliente para fiado" };
    if (input.payment === "fiado" && !this.repos.customers.byId(input.customerId as string)) {
      return { ok: false, error: "No se encontró el cliente de fiado" };
    }
    const totalCents = sumCents(items.map((item) => lineTotalCents(item.qty, item.price)));
    const costCents = sumCents(items.map((item) => lineTotalCents(item.qty, item.cost)));
    const total = toPesos(totalCents);
    const ts = nowISO();
    const sale: Sale = {
      id: uid(),
      branch_id: branchId,
      items,
      total,
      cost: toPesos(costCents),
      profit: toPesos(totalCents - costCents),
      payment: input.payment,
      customer_id: input.payment === "fiado" ? (input.customerId as string) : null,
      created_at: ts,
      updated_at: ts
    };
    for (const item of items) {
      const stockRow = this.stockRow(item.productId);
      if (stockRow) {
        this.repos.stocks.upsert({ ...stockRow, stock: normalizeQty(stockRow.stock - item.qty), updated_at: ts });
      }
    }
    if (sale.customer_id) {
      const customer = this.repos.customers.byId(sale.customer_id) as NonNullable<ReturnType<Repositories["customers"]["byId"]>>;
      this.repos.customers.upsert({
        ...customer,
        balance: Math.round((customer.balance + total) * 100) / 100,
        movements: [{ id: uid(), type: "cargo", amount: total, note: "Venta fiada", created_at: ts }, ...customer.movements],
        updated_at: ts
      });
    }
    this.repos.sales.upsert(sale);
    this.store.update((state) => {
      state.cart = [];
    });
    return { ok: true, sale };
  }

  private stockRow(productId: string): ProductStock | undefined {
    const branchId = this.branches.operationalId();
    return this.repos.stocks.all().find((row) => !row.deleted && row.product_id === productId && row.branch_id === branchId);
  }
}
