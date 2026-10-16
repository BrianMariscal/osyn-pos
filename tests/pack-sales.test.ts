import { describe, expect, it, beforeEach, vi } from "vitest";
import { Store } from "../src/domain/store";
import { createInitialState, type AppState } from "../src/domain/app-state";
import { ChangeTracker } from "../src/data/change-tracker";
import { Repositories } from "../src/data/repositories";
import { BranchService } from "../src/domain/branch-service";
import { SaleService } from "../src/domain/sale-service";
import { InventoryService } from "../src/domain/inventory-service";
import { ShiftService } from "../src/domain/shift-service";
import { SyncEngine } from "../src/data/sync-engine";
import { normalizeState } from "../src/domain/normalize";
import type { AuthService } from "../src/domain/auth-service";
import type { SupabaseClient } from "../src/data/supabase-client";
import { nowISO } from "../src/core/dates";

function fakeAuth(admin: boolean): AuthService {
  return {
    session: { access_token: "t", refresh_token: "r", expires_at: Math.floor(Date.now() / 1000) + 3600, user: { id: "u", email: "a@b.c" }, role: admin ? "dueno" : "empleado", name: "x", branch_id: "sucursal-1" },
    isAdmin: () => admin,
    isOwner: () => admin,
    assignedBranchId: () => (admin ? null : "sucursal-1"),
    refreshIfNeeded: async () => undefined
  } as unknown as AuthService;
}

function setup(admin = true) {
  const store = new Store<AppState>(createInitialState());
  const tracker = new ChangeTracker();
  const repos = new Repositories(store, tracker);
  const branches = new BranchService(store, fakeAuth(true), repos);
  branches.ensureSeeded();
  store.update((state) => {
    state.currentBranchId = "sucursal-1";
  });
  const sales = new SaleService(store, repos, branches);
  const inventory = new InventoryService(repos, branches, () => Boolean(store.getState().sync.serverStock));
  const shifts = new ShiftService(repos, branches);
  const ts = nowISO();
  // Cigarros: pieza a $10, caja de 20 a $100; costo $6 la pieza
  repos.products.upsert({ id: "cig", name: "Marlboro", category: "Cigarros", um: "Pza", cost: 6, price: 10, pack_size: 20, pack_price: 100, active: true, updated_at: ts });
  repos.stocks.upsert({ id: "cig:sucursal-1", product_id: "cig", branch_id: "sucursal-1", stock: 45, min_stock: 0, updated_at: ts });
  tracker.reset();
  return { store, tracker, repos, sales, inventory, shifts, admin };
}

describe("venta por caja o por pieza", () => {
  let ctx: ReturnType<typeof setup>;
  beforeEach(() => {
    ctx = setup();
  });

  it("una pieza cobra $10 y descuenta 1; una caja cobra $100 y descuenta 20", () => {
    expect(ctx.sales.addToCart("cig", 1).ok).toBe(true);
    expect(ctx.sales.addToCart("cig", 1, undefined, "caja").ok).toBe(true);
    const result = ctx.sales.completeSale({ payment: "efectivo", customerId: null });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.sale.total).toBe(110);
    expect(result.sale.cost).toBe(126); // 6 + 20 × 6
    expect(result.sale.items.find((item) => item.pack_size)?.price).toBe(100);
    expect(ctx.sales.stockOf("cig")).toBe(24);
  });

  it("no deja vender más cajas de las que alcanza la existencia, contando piezas sueltas", () => {
    expect(ctx.sales.addToCart("cig", 5).ok).toBe(true); // quedan 40 = 2 cajas
    expect(ctx.sales.addToCart("cig", 2, undefined, "caja").ok).toBe(true);
    const third = ctx.sales.addToCart("cig", 1, undefined, "caja");
    expect(third.ok).toBe(false);
    expect(ctx.sales.availableFor("cig", "pza")).toBe(5);
  });

  it("cambia un renglón de pieza a caja", () => {
    ctx.sales.addToCart("cig", 3);
    expect(ctx.sales.setLineUnit("cig", "pza", "caja").ok).toBe(true);
    expect(ctx.sales.cart()).toEqual([{ productId: "cig", qty: 1, unit: "caja" }]);
  });

  it("un producto sin precio de caja no se vende por caja", () => {
    ctx.repos.products.upsert({ ...ctx.repos.products.byId("cig")!, pack_price: undefined, updated_at: nowISO() });
    expect(ctx.sales.addToCart("cig", 1, undefined, "caja").ok).toBe(false);
  });

  it("el precio de caja y el carrito por caja sobreviven a recargar la app", () => {
    ctx.sales.addToCart("cig", 1, undefined, "caja");
    const reloaded = normalizeState(JSON.parse(JSON.stringify(ctx.store.getState())));
    expect(reloaded.products.find((p) => p.id === "cig")?.pack_price).toBe(100);
    expect(reloaded.cart[0]?.unit).toBe("caja");
  });
});

describe("stock llevado por el servidor", () => {
  it("la venta no marca la existencia para subir y lleva la marca stock_by_server", () => {
    const ctx = setup();
    ctx.store.update((state) => {
      state.sync = { ...state.sync, serverStock: true };
    });
    ctx.sales.addToCart("cig", 1, undefined, "caja");
    const result = ctx.sales.completeSale({ payment: "efectivo", customerId: null });
    expect(result.ok && result.sale.stock_by_server).toBe(true);
    expect(ctx.sales.stockOf("cig")).toBe(25);
    expect(ctx.tracker.isDirty("product_stocks", "cig:sucursal-1")).toBe(false);
    expect(ctx.tracker.isDirty("sales", result.ok ? result.sale.id : "")).toBe(true);
  });

  it("compras y mermas tampoco suben la existencia y llevan la marca", () => {
    const ctx = setup();
    ctx.store.update((state) => {
      state.sync = { ...state.sync, serverStock: true };
    });
    ctx.inventory.receiveStock("cig", 20, "Central de Abastos", 120);
    ctx.inventory.registerMerma("cig", 1, "Dañado", "");
    expect(ctx.sales.stockOf("cig")).toBe(64);
    expect(ctx.tracker.isDirty("product_stocks", "cig:sucursal-1")).toBe(false);
    expect(ctx.repos.purchases.list()[0]?.stock_by_server).toBe(true);
    expect(ctx.repos.mermas.list()[0]?.stock_by_server).toBe(true);
  });

  it("sin la migración sigue subiendo la existencia como antes", () => {
    const ctx = setup();
    ctx.sales.addToCart("cig", 2);
    ctx.sales.completeSale({ payment: "efectivo", customerId: null });
    expect(ctx.tracker.isDirty("product_stocks", "cig:sucursal-1")).toBe(true);
  });
});

describe("compras pagadas aparte (Central de Abastos)", () => {
  it("no se restan del efectivo esperado del corte", () => {
    const ctx = setup();
    ctx.sales.addToCart("cig", 10);
    ctx.sales.completeSale({ payment: "efectivo", customerId: null });
    ctx.inventory.receiveStockMany([{ productId: "cig", qty: 20, totalPaid: 30 }], "Distribuidora", "caja");
    ctx.inventory.receiveStockMany([{ productId: "cig", qty: 20, totalPaid: 80 }], "Central de Abastos", "aparte");
    const summary = ctx.shifts.summarize("sucursal-1");
    expect(summary.proveedores).toBe(30);
    expect(summary.proveedoresAparte).toBe(80);
    expect(summary.efectivoEsperado).toBe(70); // 100 vendido − 30 de caja
  });
});

describe("sync con stock en el servidor", () => {
  beforeEach(() => {
    vi.stubGlobal("navigator", { onLine: true });
    return () => vi.unstubAllGlobals();
  });

  it("el vendedor ya no sube existencias y descarta las pendientes", async () => {
    const store = new Store<AppState>(createInitialState());
    const tracker = new ChangeTracker();
    const repos = new Repositories(store, tracker);
    const ts = nowISO();
    repos.stocks.upsert({ id: "cig:sucursal-1", product_id: "cig", branch_id: "sucursal-1", stock: 5, min_stock: 0, updated_at: ts });
    const posted: string[] = [];
    const client = {
      configured: true,
      rest: async (path: string, _token: string, init: RequestInit = {}) => {
        if ((init.method ?? "GET") === "POST") posted.push(path.split("?")[0] ?? "");
        return { ok: true, status: 200, json: async () => [], text: async () => "" } as Response;
      },
      rpc: async (fn: string) => (fn === "pos_server_stock" ? true : {})
    } as unknown as SupabaseClient;
    store.update((state) => {
      state.settings = { ...state.settings, vendorTabs: ["venta"] };
    });
    const sync = new SyncEngine(store, client, fakeAuth(false), tracker, repos);
    const result = await sync.syncNow();
    expect(result.ok).toBe(true);
    expect(store.getState().sync.serverStock).toBe(true);
    expect(posted).not.toContain("product_stocks");
    expect(tracker.isDirty("product_stocks", "cig:sucursal-1")).toBe(false);
  });

  it("también descarta los pendientes de products del vendedor", async () => {
    const store = new Store<AppState>(createInitialState());
    const tracker = new ChangeTracker();
    const repos = new Repositories(store, tracker);
    const ts = nowISO();
    repos.products.upsert({ id: "cig", name: "Cigarros", category: "", um: "Pza", cost: 10, price: 12, active: true, updated_at: ts });
    const posted: string[] = [];
    const client = {
      configured: true,
      rest: async (path: string, _token: string, init: RequestInit = {}) => {
        if ((init.method ?? "GET") === "POST") posted.push(path.split("?")[0] ?? "");
        return { ok: true, status: 200, json: async () => [], text: async () => "" } as Response;
      },
      rpc: async (fn: string) => (fn === "pos_server_stock" ? true : {})
    } as unknown as SupabaseClient;
    store.update((state) => {
      state.settings = { ...state.settings, vendorTabs: ["venta"] };
    });
    const sync = new SyncEngine(store, client, fakeAuth(false), tracker, repos);
    const result = await sync.syncNow();
    expect(result.ok).toBe(true);
    expect(posted).not.toContain("products");
    expect(tracker.isDirty("products", "cig")).toBe(false);
  });
});
