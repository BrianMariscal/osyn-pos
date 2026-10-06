import { describe, expect, it, beforeEach } from "vitest";
import { Store } from "../src/domain/store";
import { createInitialState, type AppState } from "../src/domain/app-state";
import { ChangeTracker } from "../src/data/change-tracker";
import { Repositories } from "../src/data/repositories";
import { BranchService } from "../src/domain/branch-service";
import { SaleService } from "../src/domain/sale-service";
import { CreditService } from "../src/domain/credit-service";
import type { AuthService } from "../src/domain/auth-service";
import { nowISO } from "../src/core/dates";

function fakeAdminAuth(): AuthService {
  return {
    isAdmin: () => true,
    isOwner: () => true,
    employeeBranchId: () => null
  } as unknown as AuthService;
}

describe("sale-service", () => {
  let store: Store<AppState>;
  let repos: Repositories;
  let sales: SaleService;
  let credit: CreditService;

  beforeEach(() => {
    store = new Store<AppState>(createInitialState());
    const tracker = new ChangeTracker();
    repos = new Repositories(store, tracker);
    const branches = new BranchService(store, fakeAdminAuth(), repos);
    branches.ensureSeeded();
    store.update((state) => {
      state.currentBranchId = "sucursal-1";
    });
    sales = new SaleService(store, repos, branches);
    credit = new CreditService(repos);

    const ts = nowISO();
    repos.products.upsert({ id: "p1", name: "Coca", category: "Refrescos", um: "Pza", cost: 13, price: 18, active: true, updated_at: ts });
    repos.stocks.upsert({ id: "p1:sucursal-1", product_id: "p1", branch_id: "sucursal-1", stock: 10, min_stock: 2, updated_at: ts });
    repos.customers.upsert({ id: "c1", branch_id: "sucursal-1", name: "Juan", phone: "", balance: 0, movements: [], created_at: ts, updated_at: ts });
  });

  it("cobra una venta descontando stock y calculando total en centavos", () => {
    expect(sales.addToCart("p1", 2).ok).toBe(true);
    const result = sales.completeSale({ payment: "efectivo", customerId: null });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.sale.total).toBe(36);
      expect(result.sale.cost).toBe(26);
      expect(result.sale.profit).toBe(10);
    }
    expect(sales.stockOf("p1")).toBe(8);
    expect(sales.cart()).toHaveLength(0);
  });

  it("guarda con cuánto pagó, el cambio y quién cobró", () => {
    sales.addToCart("p1", 2);
    const result = sales.completeSale({ payment: "efectivo", customerId: null, cashReceived: 50, cashier: "Ana" });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.sale.cash_received).toBe(50);
      expect(result.sale.change).toBe(14);
      expect(result.sale.cashier).toBe("Ana");
    }
  });

  it("no cobra si el efectivo no alcanza y deja el carrito intacto", () => {
    sales.addToCart("p1", 2);
    const result = sales.completeSale({ payment: "efectivo", customerId: null, cashReceived: 20 });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("$16.00");
    expect(sales.cart()).toHaveLength(1);
    expect(sales.stockOf("p1")).toBe(10);
  });

  it("sin efectivo no guarda cambio", () => {
    sales.addToCart("p1", 1);
    const result = sales.completeSale({ payment: "tarjeta", customerId: null, cashReceived: 100 });
    expect(result.ok && result.sale.cash_received).toBeFalsy();
  });

  it("permite agregar varios productos distintos y más cantidad del mismo", () => {
    repos.products.upsert({ id: "p2", name: "Pan", category: "Panadería", um: "Pza", cost: 4, price: 6, active: true, updated_at: nowISO() });
    repos.stocks.upsert({ id: "p2:sucursal-1", product_id: "p2", branch_id: "sucursal-1", stock: 7, min_stock: 0, updated_at: nowISO() });

    expect(sales.addToCart("p1").ok).toBe(true);
    expect(sales.cart()).toHaveLength(1);

    const second = sales.addToCart("p2");
    expect(second.ok).toBe(true);
    expect(sales.cart()).toHaveLength(2);

    const more = sales.addToCart("p1", 3);
    expect(more.ok).toBe(true);
    expect(sales.cart().find((l) => l.productId === "p1")?.qty).toBe(4);

    const again = sales.addToCart("p2");
    expect(again.ok).toBe(true);
    expect(sales.cart().find((l) => l.productId === "p2")?.qty).toBe(2);
  });

  it("no vende más del stock disponible", () => {
    const capped = sales.addToCart("p1", 99);
    expect(capped.ok).toBe(true);
    expect(sales.cart()[0]?.qty).toBe(10);
    expect(sales.addToCart("p1", 1).ok).toBe(false);
  });

  it("respeta el stock por sucursal", () => {
    expect(sales.stockOf("p1")).toBe(10);
    store.update((state) => {
      state.currentBranchId = "sucursal-2";
    });
    expect(sales.stockOf("p1")).toBe(0);
    expect(sales.addToCart("p1").ok).toBe(false);
  });

  it("venta fiada incrementa el saldo del cliente y deja movimiento", () => {
    sales.addToCart("p1", 1);
    const result = sales.completeSale({ payment: "fiado", customerId: "c1" });
    expect(result.ok).toBe(true);
    const customer = repos.customers.byId("c1");
    expect(customer?.balance).toBe(18);
    expect(customer?.movements[0]?.type).toBe("cargo");
  });

  it("un pago deja el saldo en cero y avisa el sobrante", () => {
    credit.charge("c1", 50, "fiado");
    const result = credit.pay("c1", 60);
    if (!result.ok) throw new Error(result.error);
    expect(repos.customers.byId("c1")?.balance).toBe(0);
    expect(result.warning).toBeTruthy();
  });

  it("limpia el carrito si el producto se elimina", () => {
    sales.addToCart("p1", 2);
    sales.purgeProduct("p1");
    expect(sales.cart()).toHaveLength(0);
  });

  it("rechaza fiado sin cliente", () => {
    sales.addToCart("p1", 1);
    const result = sales.completeSale({ payment: "fiado", customerId: null });
    expect(result.ok).toBe(false);
  });
});
