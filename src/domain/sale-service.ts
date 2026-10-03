import { nowISO } from "../core/dates";
import { uid } from "../core/id";
import { lineTotalCents, sumCents, toPesos } from "../core/money";
import { normalizeQty } from "../core/qty";
import { fmtQty } from "../core/qty";
import type { CartLine, Customer, PaymentMethod, ProductStock, Sale, SaleItem } from "../core/types";
import { detectSaleGroup } from "./sale-groups";
import type { Repositories } from "../data/repositories";
import type { BranchService } from "./branch-service";
import type { AppState } from "./app-state";
import type { Store } from "./store";

export interface NewCustomerInput {
  name: string;
  phone?: string;
  notes?: string;
}

export interface CompleteSaleInput {
  payment: PaymentMethod;
  customerId: string | null;
  /** Fiado a un cliente que aún no existe: se da de alta al cobrar. */
  newCustomer?: NewCustomerInput | null;
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

  /** Precio que se cobra por una línea: el de oferta (si no baja del costo) o el normal. */
  unitPrice(line: CartLine): number {
    const product = this.repos.products.byId(line.productId);
    if (!product) return 0;
    const promo = line.promoPrice;
    return promo !== undefined && promo > 0 && promo >= product.cost && promo < product.price ? promo : product.price;
  }

  addToCart(productId: string, qty = 1, promoPrice?: number): SimpleResult {
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
    // Una oferta tocada se conserva para todo el renglón.
    const promo = promoPrice ?? line?.promoPrice;
    const withPromo = (l: CartLine): CartLine => (promo !== undefined ? { ...l, qty: newQty, promoPrice: promo } : { ...l, qty: newQty });
    const next = line
      ? lines.map((l) => (l.productId === productId ? withPromo(l) : l))
      : [...lines, withPromo({ productId, qty: newQty })];
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
      if (!product || product.deleted) return { ok: false, error: "Un producto del carrito ya no existe" };
      const qty = normalizeQty(line.qty);
      const available = this.stockOf(line.productId);
      if (qty <= 0 || qty > available) return { ok: false, error: "Revisa cantidades y existencia" };
      items.push({
        productId: product.id,
        name: product.name,
        qty,
        price: this.unitPrice(line),
        ...(this.unitPrice(line) !== product.price ? { regular_price: product.price } : {}),
        cost: product.cost,
        um: product.um,
        group: detectSaleGroup(product)
      });
    }
    const internal = input.payment === "interno";
    let customer: Customer | undefined;
    if (input.payment === "fiado") {
      const newName = input.newCustomer?.name.trim() ?? "";
      if (input.customerId) {
        customer = this.repos.customers.byId(input.customerId);
        if (!customer || customer.deleted) return { ok: false, error: "No se encontró el cliente de fiado" };
      } else if (!newName) {
        return { ok: false, error: "Elige un cliente o escribe el nombre del cliente nuevo" };
      }
    }
    const totalCents = sumCents(items.map((item) => lineTotalCents(item.qty, item.price)));
    const costCents = sumCents(items.map((item) => lineTotalCents(item.qty, item.cost)));
    const ts = nowISO();
    if (input.payment === "fiado" && !customer) {
      // Cliente nuevo capturado desde la venta: queda en el módulo de fiado.
      customer = {
        id: uid(),
        branch_id: branchId,
        name: (input.newCustomer?.name ?? "").trim(),
        phone: (input.newCustomer?.phone ?? "").trim(),
        notes: (input.newCustomer?.notes ?? "").trim(),
        balance: 0,
        movements: [],
        created_at: ts,
        updated_at: ts
      };
    }
    // Venta interna: se registra a costo y sin ganancia (no es ingreso).
    const total = toPesos(internal ? costCents : totalCents);
    const sale: Sale = {
      id: uid(),
      branch_id: branchId,
      items,
      total,
      cost: toPesos(costCents),
      profit: internal ? 0 : toPesos(totalCents - costCents),
      payment: input.payment,
      customer_id: customer ? customer.id : null,
      created_at: ts,
      updated_at: ts
    };
    for (const item of items) {
      const stockRow = this.stockRow(item.productId);
      if (stockRow) {
        this.repos.stocks.upsert({ ...stockRow, stock: normalizeQty(stockRow.stock - item.qty), updated_at: ts });
      }
    }
    if (customer) {
      const detail = items.map((item) => `${fmtQty(item.qty)} ${item.name}`).join(", ");
      const note = `Venta fiada: ${detail.length > 120 ? `${detail.slice(0, 117)}…` : detail}`;
      this.repos.customers.upsert({
        ...customer,
        balance: Math.round((customer.balance + total) * 100) / 100,
        movements: [{ id: uid(), type: "cargo", amount: total, note, sale_id: sale.id, created_at: ts }, ...customer.movements],
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
