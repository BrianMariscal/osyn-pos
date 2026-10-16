import { describe, expect, it, beforeEach } from "vitest";
import { Store } from "../src/domain/store";
import { createInitialState, type AppState } from "../src/domain/app-state";
import { ChangeTracker } from "../src/data/change-tracker";
import { Repositories } from "../src/data/repositories";
import { BranchService } from "../src/domain/branch-service";
import { SaleService } from "../src/domain/sale-service";
import type { AuthService } from "../src/domain/auth-service";
import { nowISO } from "../src/core/dates";
import { lineTotalCents } from "../src/core/money";
import { fmtQty } from "../src/core/qty";
import { bulkQuickPicks, bulkSubunits, defaultBulkSubunit, fromBaseQty, isBulkUnit, qtyFromAmount, toBaseQty } from "../src/core/units";

function fakeAdminAuth(): AuthService {
  return {
    isAdmin: () => true,
    isOwner: () => true,
    assignedBranchId: () => null
  } as unknown as AuthService;
}

describe("unidades a granel", () => {
  it("reconoce qué unidades se venden a báscula", () => {
    expect(isBulkUnit("Kg")).toBe(true);
    expect(isBulkUnit("Gr")).toBe(true);
    expect(isBulkUnit("Lts")).toBe(true);
    expect(isBulkUnit("Pza")).toBe(false);
    expect(isBulkUnit(undefined)).toBe(false);
  });

  it("convierte la captura a la unidad base (350 g → 0.35 Kg)", () => {
    const [gram] = bulkSubunits("Kg");
    expect(toBaseQty(350, gram!)).toBe(0.35);
    expect(toBaseQty(1.5, bulkSubunits("Kg")[1]!)).toBe(1.5);
    expect(toBaseQty(750, bulkSubunits("Lts")[0]!)).toBe(0.75);
    expect(toBaseQty(2, bulkSubunits("Lts")[1]!)).toBe(2);
    // Producto con unidad base en gramos: 1 kg = 1000 Gr
    expect(toBaseQty(1, bulkSubunits("Gr")[1]!)).toBe(1000);
  });

  it("convierte la unidad base a la subunidad para mostrarla", () => {
    const [gram, kilo] = bulkSubunits("Kg");
    expect(fromBaseQty(0.35, gram!)).toBe(350);
    expect(fromBaseQty(0.35, kilo!)).toBe(0.35);
    expect(fromBaseQty(0.75, bulkSubunits("Lts")[0]!)).toBe(750);
  });

  it("la subunidad por defecto es la que más se teclea", () => {
    expect(defaultBulkSubunit("Kg").id).toBe("g");
    expect(defaultBulkSubunit("Gr").id).toBe("g");
    expect(defaultBulkSubunit("Lts").id).toBe("l");
  });

  it("calcula la cantidad de un importe ($20 a $25/kg = 0.8 kg)", () => {
    expect(qtyFromAmount(20, 25)).toBe(0.8);
    expect(qtyFromAmount(0, 25)).toBe(0);
    expect(qtyFromAmount(20, 0)).toBe(0);
    // Con 4 decimales el total cuadra al centavo aunque no divida exacto
    const qty = qtyFromAmount(20, 30);
    expect(qty).toBe(0.6667);
    expect(lineTotalCents(qty, 30)).toBe(2000);
  });

  it("los atajos rápidos van en unidad base", () => {
    expect(bulkQuickPicks("Kg").map((p) => p.qty)).toEqual([0.25, 0.5, 1, 2]);
    expect(bulkQuickPicks("Gr")[0]!.qty).toBe(250);
    expect(bulkQuickPicks("Lts")[0]!.label).toBe("250 ml");
  });

  it("fmtQty no pierde los gramos", () => {
    expect(fmtQty(0.355)).toBe("0.355");
    expect(fmtQty(0.35)).toBe("0.35");
  });
});

describe("venta a granel (sale-service)", () => {
  let store: Store<AppState>;
  let repos: Repositories;
  let sales: SaleService;

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

    const ts = nowISO();
    repos.products.upsert({ id: "jitomate", name: "Jitomate", category: "Frutas", um: "Kg", cost: 15, price: 25, active: true, updated_at: ts });
    repos.stocks.upsert({ id: "jitomate:sucursal-1", product_id: "jitomate", branch_id: "sucursal-1", stock: 10, min_stock: 1, updated_at: ts });
  });

  it("vende 350 g de jitomate y cobra $8.75", () => {
    const [gram] = bulkSubunits("Kg");
    expect(sales.addToCart("jitomate", toBaseQty(350, gram!)).ok).toBe(true);
    expect(sales.cart()[0]?.qty).toBe(0.35);
    const result = sales.completeSale({ payment: "efectivo", customerId: null });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.sale.items[0]?.qty).toBe(0.35);
      expect(result.sale.total).toBe(8.75);
    }
    expect(sales.stockOf("jitomate")).toBe(9.65);
  });

  it("acepta 3 decimales al ajustar la cantidad (báscula)", () => {
    sales.addToCart("jitomate", 1);
    expect(sales.setCartQty("jitomate", 0.355, "pza").ok).toBe(true);
    expect(sales.cart()[0]?.qty).toBe(0.355);
  });

  it("vender $20 a $25/kg deja 0.8 kg y $20 exactos", () => {
    const qty = qtyFromAmount(20, repos.products.byId("jitomate")!.price);
    expect(sales.addToCart("jitomate", qty).ok).toBe(true);
    const result = sales.completeSale({ payment: "efectivo", customerId: null });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.sale.items[0]?.qty).toBe(0.8);
      expect(result.sale.total).toBe(20);
    }
    expect(sales.stockOf("jitomate")).toBe(9.2);
  });

  it("no vende más gramos de los que hay y recorta al límite", () => {
    repos.stocks.upsert({ id: "jitomate:sucursal-1", product_id: "jitomate", branch_id: "sucursal-1", stock: 0.3, min_stock: 0, updated_at: nowISO() });
    expect(sales.addToCart("jitomate", 1).ok).toBe(true); // se recorta a los 300 g disponibles
    expect(sales.cart()[0]?.qty).toBe(0.3);
    const result = sales.setCartQty("jitomate", 0.5, "pza");
    // El renglón se recorta a lo disponible y avisa
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("existencia");
    expect(sales.cart()[0]?.qty).toBe(0.3);
    const sale = sales.completeSale({ payment: "efectivo", customerId: null });
    expect(sale.ok).toBe(true);
    expect(sales.stockOf("jitomate")).toBe(0);
  });

  it("los productos por pieza siguen siendo enteros", () => {
    const ts = nowISO();
    repos.products.upsert({ id: "pan", name: "Pan", category: "", um: "Pza", cost: 4, price: 6, active: true, updated_at: ts });
    repos.stocks.upsert({ id: "pan:sucursal-1", product_id: "pan", branch_id: "sucursal-1", stock: 5, min_stock: 0, updated_at: ts });
    sales.addToCart("pan", 1);
    expect(sales.setCartQty("pan", 1.6, "pza").ok).toBe(true);
    expect(sales.cart()[0]?.qty).toBe(2);
  });

  it("también vende por litros a granel (750 ml)", () => {
    const ts = nowISO();
    repos.products.upsert({ id: "crema", name: "Crema a granel", category: "", um: "Lts", cost: 12, price: 20, active: true, updated_at: ts });
    repos.stocks.upsert({ id: "crema:sucursal-1", product_id: "crema", branch_id: "sucursal-1", stock: 5, min_stock: 0, updated_at: ts });
    const [ml] = bulkSubunits("Lts");
    expect(sales.addToCart("crema", toBaseQty(750, ml!)).ok).toBe(true);
    expect(sales.cart()[0]?.qty).toBe(0.75);
    const result = sales.completeSale({ payment: "tarjeta", customerId: null });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.sale.total).toBe(15);
    expect(sales.stockOf("crema")).toBe(4.25);
  });
});
