import { describe, expect, it, beforeEach } from "vitest";
import { Store } from "../src/domain/store";
import { createInitialState, type AppState } from "../src/domain/app-state";
import { ChangeTracker } from "../src/data/change-tracker";
import { Repositories } from "../src/data/repositories";
import { BranchService } from "../src/domain/branch-service";
import { InventoryService } from "../src/domain/inventory-service";
import type { AuthService } from "../src/domain/auth-service";
import { nowISO } from "../src/core/dates";

function fakeAdminAuth(): AuthService {
  return { isAdmin: () => true, isOwner: () => true, assignedBranchId: () => null } as unknown as AuthService;
}

describe("entradas y mermas de inventario", () => {
  let inventory: InventoryService;
  let repos: Repositories;

  beforeEach(() => {
    const store = new Store<AppState>(createInitialState());
    const tracker = new ChangeTracker();
    repos = new Repositories(store, tracker);
    const branches = new BranchService(store, fakeAdminAuth(), repos);
    branches.ensureSeeded();
    store.update((state) => {
      state.currentBranchId = "sucursal-1";
    });
    inventory = new InventoryService(repos, branches);
    const ts = nowISO();
    repos.products.upsert({ id: "p1", name: "Coca", category: "Refrescos", um: "Pza", cost: 13, price: 18, active: true, updated_at: ts });
    repos.stocks.upsert({ id: "p1:sucursal-1", product_id: "p1", branch_id: "sucursal-1", stock: 10, min_stock: 2, updated_at: ts });
  });

  it("entrada de mercancía suma stock y registra compra", () => {
    const result = inventory.receiveStock("p1", 5, "Central de Abastos", 65);
    expect(result.ok).toBe(true);
    expect(inventory.stockEverywhere("p1")[0]?.stock).toBe(15);
    const purchase = repos.purchases.list()[0];
    expect(purchase?.supplier).toBe("Central de Abastos");
    expect(purchase?.qty).toBe(5);
    // El costo promedio se recalcula con el pago
    expect(repos.products.byId("p1")?.cost).toBe(13);
  });

  it("merma descuenta stock y registra impacto a costo", () => {
    const result = inventory.registerMerma("p1", 3, "Dañado", "se rompieron");
    expect(result.ok).toBe(true);
    expect(inventory.stockEverywhere("p1")[0]?.stock).toBe(7);
    const merma = repos.mermas.list()[0];
    expect(merma?.reason).toBe("Dañado");
    expect(merma?.cost_impact).toBe(39);
    expect(inventory.mermaHistory()).toHaveLength(1);
  });

  it("no acepta merma mayor a la existencia", () => {
    const result = inventory.registerMerma("p1", 11, "Caducado", "");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("Solo hay 10");
  });

  it("la merma a granel conserva la precisión de gramo", () => {
    const ts = nowISO();
    repos.products.upsert({ id: "jitomate", name: "Jitomate", category: "Frutas", um: "Kg", cost: 15, price: 25, active: true, updated_at: ts });
    repos.stocks.upsert({ id: "jitomate:sucursal-1", product_id: "jitomate", branch_id: "sucursal-1", stock: 2, min_stock: 0, updated_at: ts });
    const result = inventory.registerMerma("jitomate", 0.125, "Dañado", "");
    expect(result.ok).toBe(true);
    expect(inventory.stockEverywhere("jitomate")[0]?.stock).toBe(1.875);
    expect(repos.mermas.list().find((m) => m.product_id === "jitomate")?.qty).toBe(0.125);
  });
});
