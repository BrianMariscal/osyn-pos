import { describe, expect, it, beforeEach } from "vitest";
import { Store } from "../src/domain/store";
import { createInitialState, type AppState } from "../src/domain/app-state";
import { ChangeTracker } from "../src/data/change-tracker";
import { Repositories } from "../src/data/repositories";
import type { Customer, Product, ProductStock } from "../src/core/types";

describe("sync merge (repositorio)", () => {
  let store: Store<AppState>;
  let repos: Repositories;
  let tracker: ChangeTracker;

  beforeEach(() => {
    store = new Store<AppState>(createInitialState());
    tracker = new ChangeTracker();
    repos = new Repositories(store, tracker);
  });

  it("marca filas dirty al escribir y limpia al sincronizar", () => {
    const product: Product = { id: "p1", name: "Coca", category: "", um: "Pza", cost: 10, price: 15, active: true, updated_at: "2026-01-01T00:00:00Z" };
    repos.products.upsert(product);
    expect(tracker.pendingCount()).toBe(1);
    expect(tracker.takeIds("products")).toEqual(["p1"]);
    tracker.clear("products", ["p1"]);
    expect(tracker.pendingCount()).toBe(0);
  });

  it("puede restaurar la cola offline después de recargar", () => {
    tracker.mark("products", "p1");
    tracker.recordDelta("product_stocks", "p1:branch", { stock: -2 });

    const restored = new ChangeTracker();
    restored.restore(tracker.snapshot());

    expect(restored.takeIds("products")).toEqual(["p1"]);
    expect(restored.pendingDelta("product_stocks", "p1:branch")).toEqual({ stock: -2 });
  });

  it("mezcla la nube sin marcar dirty y respeta last-write-wins", () => {
    const local: Product = { id: "p1", name: "Local", category: "", um: "Pza", cost: 10, price: 15, active: true, updated_at: "2026-01-02T00:00:00Z" };
    repos.products.upsert(local);
    tracker.reset();

    const cloudOlder: Product = { id: "p2", name: "Nueva nube", category: "", um: "Pza", cost: 1, price: 2, active: true, updated_at: "2026-01-01T00:00:00Z" };
    const cloudNewer: Product = { id: "p1", name: "Nube ganadora", category: "", um: "Pza", cost: 10, price: 20, active: true, updated_at: "2026-01-03T00:00:00Z" };
    repos.products.mergeFromCloud([cloudOlder, cloudNewer]);

    const products = store.getState().products;
    expect(products).toHaveLength(2);
    expect(products.find((p) => p.id === "p1")?.name).toBe("Nube ganadora");
    expect(products.find((p) => p.id === "p2")?.name).toBe("Nueva nube");
    expect(tracker.pendingCount()).toBe(0);
  });

  it("softDelete genera tombstone que se propaga en sync", () => {
    const product: Product = { id: "p1", name: "Coca", category: "", um: "Pza", cost: 10, price: 15, active: true, updated_at: "2026-01-01T00:00:00Z" };
    repos.products.upsert(product);
    repos.products.softDelete("p1");

    expect(repos.products.list()).toHaveLength(0); // vivas
    const all = repos.products.all();
    expect(all[0]?.deleted).toBe(true);
    expect(tracker.takeIds("products")).toContain("p1");

    // La nube manda la fila vieja viva: la tombstone local es más nueva y gana
    const cloudAlive: Product = { id: "p1", name: "Coca", category: "", um: "Pza", cost: 10, price: 15, active: true, updated_at: "2026-01-01T00:00:00Z" };
    repos.products.mergeFromCloud([cloudAlive]);
    expect(repos.products.list()).toHaveLength(0);
  });

  it("acumula el delta de una venta offline (stock 10 → 7) y lo aplica sobre la nube", () => {
    const ts = "2026-01-01T00:00:00Z";
    repos.stocks.upsert({ id: "p1:sucursal-1", product_id: "p1", branch_id: "sucursal-1", stock: 10, min_stock: 2, updated_at: ts });
    tracker.reset(); // sincronizado: base 10

    // Venta local offline sin internet: 10 → 7
    repos.stocks.upsert({ id: "p1:sucursal-1", product_id: "p1", branch_id: "sucursal-1", stock: 7, min_stock: 2, updated_at: "2026-01-02T00:00:00Z" });
    expect(tracker.pendingDelta("product_stocks", "p1:sucursal-1")).toEqual({ stock: -3 });

    // Otro dispositivo vendió 2 en la nube después: stock 8
    const cloudNewer: ProductStock = { id: "p1:sucursal-1", product_id: "p1", branch_id: "sucursal-1", stock: 8, min_stock: 2, updated_at: "2026-01-03T00:00:00Z" };
    const conflicts = repos.stocks.mergeFromCloud([cloudNewer]);

    // Sin conflicto sin resolver: la venta local NO se pierde (8 + delta −3 = 5)
    expect(conflicts).toHaveLength(0);
    expect(store.getState().product_stocks[0]?.stock).toBe(5);
    // El delta quedó aplicado a la fila, que sigue dirty para subirse
    expect(tracker.pendingDelta("product_stocks", "p1:sucursal-1")).toBeUndefined();
    expect(tracker.isDirty("product_stocks", "p1:sucursal-1")).toBe(true);
  });

  it("no marca conflicto si la fila local ya está sincronizada", () => {
    const row: ProductStock = { id: "p1:sucursal-1", product_id: "p1", branch_id: "sucursal-1", stock: 7, min_stock: 2, updated_at: "2026-01-02T00:00:00Z" };
    repos.stocks.upsert(row);
    tracker.reset(); // se sincronizó: ya no está dirty

    const cloudNewer: ProductStock = { id: "p1:sucursal-1", product_id: "p1", branch_id: "sucursal-1", stock: 8, min_stock: 2, updated_at: "2026-01-03T00:00:00Z" };
    const conflicts = repos.stocks.mergeFromCloud([cloudNewer]);
    expect(conflicts).toHaveLength(0);
    expect(store.getState().product_stocks[0]?.stock).toBe(8);
  });

  it("un pago offline no se pierde cuando la nube trae un cargo nuevo", () => {
    const base: Customer = {
      id: "c1", branch_id: "sucursal-1", name: "Juan", phone: "", balance: 100, movements: [
        { id: "m0", type: "cargo", amount: 100, note: "original", created_at: "2026-01-01T00:00:00Z" }
      ],
      created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-01T00:00:00Z"
    };
    repos.customers.upsert(base);
    tracker.reset(); // sincronizado

    // Pago local offline: 100 → 50 con su movimiento
    repos.customers.upsert({
      ...base,
      balance: 50,
      movements: [{ id: "m1", type: "pago", amount: 50, note: "pago offline", created_at: "2026-01-02T00:00:00Z" }, ...base.movements],
      updated_at: "2026-01-02T00:00:00Z"
    });

    // Cargo en la nube después: balance 150 (con su propio movimiento)
    const cloudNewer: Customer = {
      ...base,
      balance: 150,
      movements: [{ id: "m2", type: "cargo", amount: 50, note: "cargo nube", created_at: "2026-01-03T00:00:00Z" }, ...base.movements],
      updated_at: "2026-01-03T00:00:00Z"
    };
    const conflicts = repos.customers.mergeFromCloud([cloudNewer]);
    expect(conflicts).toHaveLength(0);

    const merged = store.getState().customers[0];
    expect(merged?.balance).toBe(100); // 150 (nube) − 50 (pago local)
    const ids = merged?.movements.map((m) => m.id).sort();
    expect(ids).toEqual(["m0", "m1", "m2"]); // sin duplicar el movimiento de la nube
  });

  it("avisa (conflicto) si la nube borra una fila de stock con cambio local", () => {
    repos.stocks.upsert({ id: "p1:sucursal-1", product_id: "p1", branch_id: "sucursal-1", stock: 10, min_stock: 2, updated_at: "2026-01-01T00:00:00Z" });
    tracker.reset();
    repos.stocks.upsert({ id: "p1:sucursal-1", product_id: "p1", branch_id: "sucursal-1", stock: 7, min_stock: 2, updated_at: "2026-01-02T00:00:00Z" });

    const cloudDeleted: ProductStock = { id: "p1:sucursal-1", product_id: "p1", branch_id: "sucursal-1", stock: 8, min_stock: 2, deleted: true, updated_at: "2026-01-03T00:00:00Z" };
    const conflicts = repos.stocks.mergeFromCloud([cloudDeleted]);
    expect(conflicts).toEqual(["p1:sucursal-1"]);
    expect(store.getState().product_stocks[0]?.deleted).toBe(true);
  });
});
