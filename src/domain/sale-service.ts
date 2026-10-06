import { nowISO } from "../core/dates";
import { uid } from "../core/id";
import { fmtMoney, lineTotalCents, sumCents, toCents, toPesos } from "../core/money";
import { normalizeQty } from "../core/qty";
import { fmtQty } from "../core/qty";
import type { CartLine, CartUnit, Customer, PaymentMethod, ProductStock, Sale, SaleItem } from "../core/types";
import { moveStock } from "./stock-moves";
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
  /** Efectivo: con cuánto pagó el cliente (opcional; sin valor no se calcula cambio). */
  cashReceived?: number | null;
  /** Nombre de quien cobra (aparece en el ticket). */
  cashier?: string;
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

  /** ¿El producto se vende también por caja? (piezas por caja y precio de caja). */
  sellsByPack(productId: string): boolean {
    const product = this.repos.products.byId(productId);
    return Boolean(product && (product.pack_size ?? 0) > 1 && (product.pack_price ?? 0) > 0);
  }

  /** Piezas que ocupa una unidad del renglón (1 o las piezas de la caja). */
  piecesPerUnit(productId: string, unit: CartUnit = "pza"): number {
    if (unit !== "caja") return 1;
    return Math.max(1, Math.round(this.repos.products.byId(productId)?.pack_size ?? 1));
  }

  /** Precio que se cobra por una línea: caja, oferta (si no baja del costo) o normal. */
  unitPrice(line: CartLine): number {
    const product = this.repos.products.byId(line.productId);
    if (!product) return 0;
    if (line.unit === "caja") return product.pack_price ?? 0;
    const promo = line.promoPrice;
    return promo !== undefined && promo > 0 && promo >= product.cost && promo < product.price ? promo : product.price;
  }

  /** Cuántas unidades (piezas o cajas) caben en la existencia, sin contar ese renglón. */
  availableFor(productId: string, unit: CartUnit = "pza"): number {
    const others = this.store
      .getState()
      .cart.filter((l) => l.productId === productId && unitOf(l) !== unit)
      .reduce((sum, l) => sum + normalizeQty(l.qty) * this.piecesPerUnit(productId, unitOf(l)), 0);
    const free = Math.max(0, this.stockOf(productId) - others);
    return unit === "caja" ? Math.floor(free / this.piecesPerUnit(productId, "caja")) : normalizeQty(free);
  }

  addToCart(productId: string, qty = 1, promoPrice?: number, unit: CartUnit = "pza"): SimpleResult {
    const product = this.repos.products.byId(productId);
    if (!product || product.active === false) return { ok: false, error: "Producto no disponible" };
    if (unit === "caja" && !this.sellsByPack(productId)) return { ok: false, error: "Este producto no se vende por caja" };
    const available = this.availableFor(productId, unit);
    const lines = this.store.getState().cart;
    const line = lines.find((l) => isLine(l, productId, unit));
    const currentQty = line?.qty ?? 0;
    let newQty = normalizeQty(currentQty + normalizeQty(qty));
    if (unit === "caja") newQty = Math.round(newQty);
    if (newQty <= 0) return { ok: false, error: "Cantidad inválida" };
    if (newQty > available) {
      if (available <= currentQty) {
        const branchName = this.branches.name(this.branches.operationalId());
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
    this.store.update((state) => {
      state.cart = next;
    });
    return { ok: true };
  }

  setCartQty(productId: string, qty: number | string, unit: CartUnit = "pza"): SimpleResult {
    const lines = this.store.getState().cart;
    if (!lines.some((l) => isLine(l, productId, unit))) return { ok: false, error: "No está en el carrito" };
    const product = this.repos.products.byId(productId);
    // Piezas y cajas: solo enteros (fin de decimales raros como 1.03 en productos de pieza)
    const value = product?.um === "Pza" || unit === "caja" ? Math.round(normalizeQty(qty)) : normalizeQty(qty);
    if (value <= 0) {
      this.removeFromCart(productId, unit);
      return { ok: true };
    }
    const available = this.availableFor(productId, unit);
    if (value > available) {
      const capped = available > 0
        ? lines.map((l) => (isLine(l, productId, unit) ? { ...l, qty: available } : l))
        : lines.filter((l) => !isLine(l, productId, unit));
      this.store.update((state) => {
        state.cart = capped;
      });
      return { ok: false, error: "No hay más existencia" };
    }
    const next = lines.map((l) => (isLine(l, productId, unit) ? { ...l, qty: value } : l));
    this.store.update((state) => {
      state.cart = next;
    });
    return { ok: true };
  }

  /** Cambia un renglón entre pieza y caja (se suma si ya había uno en la otra unidad). */
  setLineUnit(productId: string, from: CartUnit, to: CartUnit): SimpleResult {
    if (from === to) return { ok: true };
    const line = this.store.getState().cart.find((l) => isLine(l, productId, from));
    if (!line) return { ok: false, error: "No está en el carrito" };
    if (to === "caja" && !this.sellsByPack(productId)) return { ok: false, error: "Este producto no se vende por caja" };
    this.removeFromCart(productId, from);
    const result = this.addToCart(productId, to === "caja" ? 1 : this.piecesPerUnit(productId, from) * line.qty, undefined, to);
    if (!result.ok) {
      // Sin existencia para la otra unidad: se deja como estaba.
      this.store.update((state) => {
        state.cart = [...state.cart, line];
      });
    }
    return result;
  }

  removeFromCart(productId: string, unit?: CartUnit): void {
    this.store.update((state) => {
      state.cart = state.cart.filter((line) => line.productId !== productId || (unit !== undefined && unitOf(line) !== unit));
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
    const piecesByProduct = new Map<string, number>();
    for (const line of cart) {
      const product = this.repos.products.byId(line.productId);
      if (!product || product.deleted) return { ok: false, error: "Un producto del carrito ya no existe" };
      const unit = unitOf(line);
      if (unit === "caja" && !this.sellsByPack(product.id)) return { ok: false, error: `${product.name} ya no se vende por caja` };
      const qty = normalizeQty(line.qty);
      const perUnit = this.piecesPerUnit(product.id, unit);
      const pieces = normalizeQty((piecesByProduct.get(product.id) ?? 0) + qty * perUnit);
      piecesByProduct.set(product.id, pieces);
      if (qty <= 0 || pieces > this.stockOf(line.productId)) return { ok: false, error: "Revisa cantidades y existencia" };
      const price = this.unitPrice(line);
      items.push({
        productId: product.id,
        name: product.name,
        qty,
        price,
        ...(unit === "pza" && price !== product.price ? { regular_price: product.price } : {}),
        ...(unit === "caja" ? { pack_size: perUnit } : {}),
        // Costo del renglón por unidad vendida: una caja cuesta sus piezas.
        cost: toPesos(Math.round(toCents(product.cost) * perUnit)),
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
    const cashReceived = input.payment === "efectivo" && input.cashReceived && input.cashReceived > 0 ? input.cashReceived : null;
    if (cashReceived !== null && toCents(cashReceived) < totalCents) {
      return { ok: false, error: `El pago no alcanza: faltan ${fmtMoney(totalCents - toCents(cashReceived))}` };
    }
    const serverStock = Boolean(this.store.getState().sync.serverStock);
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
      ...(serverStock ? { stock_by_server: true } : {}),
      ...(cashReceived !== null ? { cash_received: cashReceived, change: toPesos(toCents(cashReceived) - totalCents) } : {}),
      ...(input.cashier ? { cashier: input.cashier } : {}),
      created_at: ts,
      updated_at: ts
    };
    for (const [productId, pieces] of piecesByProduct) {
      moveStock(this.repos, serverStock, productId, branchId, -pieces, ts);
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

function unitOf(line: CartLine): CartUnit {
  return line.unit === "caja" ? "caja" : "pza";
}

function isLine(line: CartLine, productId: string, unit: CartUnit): boolean {
  return line.productId === productId && unitOf(line) === unit;
}
