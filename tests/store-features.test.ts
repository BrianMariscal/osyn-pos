import { describe, expect, it, beforeEach } from "vitest";
import { Store, sameSelection } from "../src/domain/store";
import { createInitialState, type AppState } from "../src/domain/app-state";
import { ChangeTracker } from "../src/data/change-tracker";
import { Repositories } from "../src/data/repositories";
import { BranchService } from "../src/domain/branch-service";
import { SaleService } from "../src/domain/sale-service";
import { ShiftService } from "../src/domain/shift-service";
import { ReportService } from "../src/domain/report-service";
import { InventoryService, unitsFromPacks } from "../src/domain/inventory-service";
import { ExpenseService, dailyTargetCents, fixedCostsForRange } from "../src/domain/expense-service";
import { detectSaleGroup } from "../src/domain/sale-groups";
import { assignMissingSupplierNumbers, nextSupplierNumber, productMatches, resolveScannedCode } from "../src/domain/catalog";
import { normalizeState } from "../src/domain/normalize";
import { dayRange, monthInputValue, monthRange, nowISO } from "../src/core/dates";
import type { AuthService } from "../src/domain/auth-service";
import type { Expense, Product } from "../src/core/types";

function fakeAdminAuth(): AuthService {
  return { isAdmin: () => true, isOwner: () => true, assignedBranchId: () => null } as unknown as AuthService;
}

const ts = "2026-10-02T15:00:00.000Z";

function product(partial: Partial<Product> & { id: string; name: string }): Product {
  return { category: "", um: "Pza", cost: 10, price: 15, active: true, updated_at: ts, ...partial };
}

describe("funciones de la tienda", () => {
  let store: Store<AppState>;
  let repos: Repositories;
  let sales: SaleService;
  let shifts: ShiftService;
  let reports: ReportService;
  let inventory: InventoryService;
  let expenses: ExpenseService;

  beforeEach(() => {
    store = new Store<AppState>(createInitialState());
    repos = new Repositories(store, new ChangeTracker());
    const branches = new BranchService(store, fakeAdminAuth(), repos);
    branches.ensureSeeded();
    store.update((state) => {
      state.currentBranchId = "sucursal-1";
    });
    sales = new SaleService(store, repos, branches);
    shifts = new ShiftService(repos, branches);
    reports = new ReportService(repos, store);
    inventory = new InventoryService(repos, branches);
    expenses = new ExpenseService(repos, branches);
    const now = nowISO();
    repos.products.upsert(product({ id: "coca", name: "Coca 600", category: "Refrescos", cost: 13, price: 18, updated_at: now }));
    repos.products.upsert(product({ id: "marl", name: "Marlboro rojo", category: "Cigarros", cost: 70, price: 85, updated_at: now }));
    repos.products.upsert(product({ id: "tec", name: "Tecate lata", category: "Bebidas", cost: 17, price: 22, updated_at: now }));
    repos.products.upsert(product({ id: "cloro", name: "Cloro 1L", category: "Limpieza", cost: 12, price: 20, updated_at: now }));
    for (const id of ["coca", "marl", "tec", "cloro"]) {
      repos.stocks.upsert({ id: `${id}:sucursal-1`, product_id: id, branch_id: "sucursal-1", stock: 20, min_stock: 0, updated_at: now });
    }
  });

  it("venta interna baja inventario pero no suma a ventas ni al corte", () => {
    sales.addToCart("cloro", 2);
    const result = sales.completeSale({ payment: "interno", customerId: null });
    expect(result.ok).toBe(true);
    expect(sales.stockOf("cloro")).toBe(18);
    if (result.ok) {
      expect(result.sale.total).toBe(24); // a costo
      expect(result.sale.profit).toBe(0);
    }
    const summary = shifts.summarize("sucursal-1");
    expect(summary.ventas).toBe(0);
    expect(summary.efectivo).toBe(0);
    expect(summary.interno).toBe(24);
    const range = { start: new Date(Date.now() - 3600_000).toISOString(), end: new Date(Date.now() + 3600_000).toISOString() };
    const report = reports.periodReport("sucursal-1", range.start, range.end);
    expect(report.sales_total).toBe(0);
    expect(report.sales_count).toBe(0);
    expect(report.internal_total).toBe(24);
    expect(report.top_products).toHaveLength(0);
  });

  it("el corte separa cigarros y cerveza", () => {
    sales.addToCart("coca", 1);
    sales.addToCart("marl", 2);
    sales.addToCart("tec", 3);
    expect(sales.completeSale({ payment: "efectivo", customerId: null }).ok).toBe(true);
    const summary = shifts.summarize("sucursal-1");
    expect(summary.ventas).toBe(18 + 170 + 66);
    expect(summary.cigarros).toBe(170);
    expect(summary.cerveza).toBe(66);
  });

  it("detecta el grupo por categoría o nombre y respeta el explícito", () => {
    expect(detectSaleGroup({ name: "Delicados", category: "Tabaco" })).toBe("cigarros");
    expect(detectSaleGroup({ name: "Caguama Victoria", category: "Bebidas" })).toBe("cerveza");
    expect(detectSaleGroup({ name: "Coca", category: "Refrescos" })).toBe("general");
    expect(detectSaleGroup({ name: "Corona", category: "Cerveza", sale_group: "general" })).toBe("general");
  });

  it("fiado con cliente nuevo: lo crea y le carga la venta con detalle", () => {
    sales.addToCart("coca", 2);
    const result = sales.completeSale({ payment: "fiado", customerId: null, newCustomer: { name: "Doña Mary", phone: "555", notes: "Calle 3" } });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const customer = repos.customers.byId(result.sale.customer_id!);
    expect(customer?.name).toBe("Doña Mary");
    expect(customer?.notes).toBe("Calle 3");
    expect(customer?.balance).toBe(36);
    expect(customer?.movements[0]?.sale_id).toBe(result.sale.id);
    expect(customer?.movements[0]?.note).toContain("Coca 600");
  });

  it("fiado sin cliente ni nombre se rechaza sin crear nada", () => {
    sales.addToCart("coca", 1);
    const result = sales.completeSale({ payment: "fiado", customerId: null, newCustomer: { name: "  " } });
    expect(result.ok).toBe(false);
    expect(repos.customers.list()).toHaveLength(0);
    expect(sales.stockOf("coca")).toBe(20);
  });

  it("costos fijos: meta diaria y prorrateo por rango", () => {
    expect(expenses.add("fijo", "Renta", 3100, "Renta").ok).toBe(true);
    expect(expenses.add("extra", "Garrafón", 40, "Varios").ok).toBe(true);
    expect(expenses.monthlyFixedCents()).toBe(310_000);
    // Octubre tiene 31 días → $100 diarios
    expect(dailyTargetCents(310_000, new Date(2026, 9, 2))).toBe(10_000);
    const fixed: Expense[] = [{ id: "r", branch_id: "s", concept: "Renta", amount: 3100, category: "Renta", kind: "fijo", created_at: new Date(2026, 9, 1, 10).toISOString(), updated_at: ts }];
    const oct = monthRange("2026-10");
    expect(fixedCostsForRange(fixed, oct.start, oct.end)).toBe(310_000);
    const day = dayRange("2026-10-15");
    expect(fixedCostsForRange(fixed, day.start, day.end)).toBe(10_000);
    // Antes del mes de alta no aplica
    const sep = monthRange("2026-09");
    expect(fixedCostsForRange(fixed, sep.start, sep.end)).toBe(0);
  });

  it("volver a capturar un costo fijo lo actualiza en vez de duplicarlo", () => {
    expect(expenses.add("fijo", "Renta", 3100, "Renta").ok).toBe(true);
    const second = expenses.add("fijo", "  renta  ", 3500, "Renta");
    expect(second.ok).toBe(true);
    if (second.ok) expect(second.replaced).toBe(true);
    expect(repos.expenses.list()).toHaveLength(1);
    expect(expenses.monthlyFixedCents()).toBe(350_000);
    // Un gasto extra con el mismo nombre sí es un movimiento nuevo.
    expect(expenses.add("extra", "Renta", 100, "Renta").ok).toBe(true);
    expect(repos.expenses.list()).toHaveLength(2);
  });

  it("detecta y unifica costos fijos duplicados de datos viejos", () => {
    const now = nowISO();
    const later = new Date(Date.parse(now) + 1000).toISOString();
    repos.expenses.upsert({ id: "r1", branch_id: "sucursal-1", concept: "Renta", amount: 3000, category: "Renta", kind: "fijo", period: "mensual", created_at: now, updated_at: now });
    repos.expenses.upsert({ id: "r2", branch_id: "sucursal-1", concept: "RENTA", amount: 3000, category: "Renta", kind: "fijo", period: "mensual", created_at: now, updated_at: later });

    expect(expenses.duplicateFixedCosts()).toHaveLength(1);
    expect(expenses.mergeDuplicateFixedCosts()).toBe(1);
    expect(repos.expenses.list()).toHaveLength(1);
    expect(repos.expenses.list()[0]!.id).toBe("r2");
    expect(expenses.monthlyFixedCents()).toBe(300_000);
  });

  it("el mes en curso se reporta a la fecha, no con costos futuros", () => {
    expenses.add("fijo", "Renta", 3100, "Renta");
    const report = reports.monthReport("sucursal-1", monthInputValue());
    expect(Date.parse(report.start)).toBeLessThanOrEqual(Date.parse(report.end));
    expect(Date.parse(report.end)).toBeLessThanOrEqual(Date.now() + 1000);
  });

  it("el corte solo descuenta de caja los gastos extra, no los fijos", () => {
    expenses.add("fijo", "Renta", 3000, "Renta");
    expenses.add("extra", "Garrafón", 40, "Varios");
    expenses.add("extra", "Luz", 100, "Luz", "mensual", "aparte");
    const summary = shifts.summarize("sucursal-1");
    expect(summary.gastos).toBe(40);
    expect(summary.gastosAparte).toBe(100);
    expect(summary.efectivoEsperado).toBe(-40);
  });

  it("se pueden eliminar gastos", () => {
    expenses.add("extra", "Garrafón", 40, "Varios");
    const id = repos.expenses.list()[0]!.id;
    expect(expenses.remove(id).ok).toBe(true);
    expect(repos.expenses.list()).toHaveLength(0);
    expect(expenses.remove(id).ok).toBe(false);
  });

  it("convierte cajas a piezas y lo registra en la compra", () => {
    expect(unitsFromPacks(3, 12)).toBe(36);
    expect(unitsFromPacks(3, 12, 2)).toBe(38);
    expect(unitsFromPacks(5, undefined)).toBe(5);
    const result = inventory.receiveStockMany([{ productId: "coca", qty: unitsFromPacks(2, 24), totalPaid: 600, packs: 2, packSize: 24 }], "Coca-Cola FEMSA");
    expect(result.ok).toBe(true);
    expect(sales.stockOf("coca")).toBe(68);
    const purchase = repos.purchases.list()[0]!;
    expect(purchase.qty).toBe(48);
    expect(purchase.packs).toBe(2);
    expect(purchase.pack_size).toBe(24);
  });

  it("aplicar conteo crea la existencia si el producto no tenía fila", () => {
    repos.products.upsert(product({ id: "nuevo", name: "Chicle" }));
    inventory.start();
    inventory.setCount("nuevo", "7");
    const applied = inventory.apply();
    expect(applied.ok).toBe(true);
    expect(sales.stockOf("nuevo")).toBe(7);
  });

  it("el conteo compara contra la existencia al capturar y conserva ventas posteriores", () => {
    inventory.start();
    // Existencia del sistema al capturar: 20.
    inventory.setCount("coca", "18");
    expect(inventory.baselineFor("coca")).toBe(20);

    // Venta después del conteo: el sistema baja a 17, el físico sigue en 18.
    sales.addToCart("coca", 3);
    expect(sales.completeSale({ payment: "efectivo", customerId: null }).ok).toBe(true);
    expect(sales.stockOf("coca")).toBe(17);

    // Corregir la captura no vuelve a tomar la base.
    inventory.setCount("coca", "18");
    expect(inventory.baselineFor("coca")).toBe(20);

    const summary = inventory.summary();
    expect(summary?.incidences.find((row) => row.product_id === "coca")?.difference).toBe(-2);

    // 18 físicos − 20 al contar = −2; sobre los 17 actuales quedan 15.
    const applied = inventory.apply();
    expect(applied.ok).toBe(true);
    expect(sales.stockOf("coca")).toBe(15);
  });

  it("borrar una captura permite volver a tomar la base", () => {
    inventory.start();
    inventory.setCount("coca", "19");
    inventory.setCount("coca", "");
    expect(inventory.baselineFor("coca")).toBeUndefined();
  });

  it("el conteo activo se puede guardar y recuperar", () => {
    inventory.start();
    inventory.setCount("coca", "15");
    const saved = JSON.parse(JSON.stringify(inventory.snapshot()));
    const other = new InventoryService(repos, new BranchService(store, fakeAdminAuth(), repos));
    other.restore(saved);
    expect(other.countedValue("coca")).toBe("15");
    expect(other.baselineFor("coca")).toBe(20);
    other.restore({ basura: true });
    expect(other.countedValue("coca")).toBe("15");
  });

  it("los campos nuevos sobreviven a la normalización del snapshot", () => {
    repos.products.upsert(product({ id: "p", name: "Caja", supplier_id: "s1", pack_size: 12, sale_group: "cerveza" }));
    repos.suppliers.upsert({ id: "s1", number: 4, name: "Modelo", type: "Cerveza", phone: "", notes: "", updated_at: ts });
    expenses.add("fijo", "Luz", 800, "Luz");
    const restored = normalizeState(JSON.parse(JSON.stringify(store.getState())));
    const p = restored.products.find((row) => row.id === "p");
    expect(p?.supplier_id).toBe("s1");
    expect(p?.pack_size).toBe(12);
    expect(p?.sale_group).toBe("cerveza");
    expect(restored.suppliers[0]?.number).toBe(4);
    expect(restored.suppliers[0]?.type).toBe("Cerveza");
    expect(restored.expenses[0]?.kind).toBe("fijo");
  });
});

describe("catálogo", () => {
  const products: Product[] = [
    product({ id: "a", name: "Coca 600", barcode: "750100", supplier_id: "s1" }),
    product({ id: "b", name: "Pan dulce", supplier_id: "s2" })
  ];

  it("resuelve código de barras, QR de la app y nombre", () => {
    expect(resolveScannedCode(products, "750100")?.id).toBe("a");
    expect(resolveScannedCode(products, "POS:b")?.id).toBe("b");
    expect(resolveScannedCode(products, "pan dulce")?.id).toBe("b");
    expect(resolveScannedCode(products, "999")).toBeUndefined();
  });

  it("busca por proveedor y por número de proveedor", () => {
    const supplier = { id: "s1", number: 3, name: "FEMSA", type: "Refrescos", phone: "", notes: "", updated_at: ts };
    expect(productMatches(products[0]!, "femsa", supplier)).toBe(true);
    expect(productMatches(products[0]!, "#3", supplier)).toBe(true);
    expect(productMatches(products[0]!, "#4", supplier)).toBe(false);
    expect(productMatches(products[1]!, "coca")).toBe(false);
  });

  it("numera proveedores consecutivamente sin repetir", () => {
    const list = [
      { id: "x", number: 2, name: "A", phone: "", notes: "", updated_at: ts },
      { id: "y", name: "B", phone: "", notes: "", created_at: "2026-01-01", updated_at: ts },
      { id: "z", name: "C", phone: "", notes: "", created_at: "2025-01-01", updated_at: ts }
    ];
    expect(nextSupplierNumber(list)).toBe(3);
    const numbered = assignMissingSupplierNumbers(list);
    expect(numbered.map((s) => [s.id, s.number])).toEqual([["z", 3], ["y", 4]]);
  });
});

describe("store.watch", () => {
  it("no redibuja con tuplas iguales (antes redibujaba en cada cambio)", () => {
    const store = new Store<AppState>(createInitialState());
    let calls = 0;
    store.watch((s) => [s.products, s.currentBranchId] as const, () => {
      calls += 1;
    });
    store.update((s) => {
      s.sync = { ...s.sync, syncing: true };
    });
    expect(calls).toBe(1);
    store.update((s) => {
      s.products = [];
    });
    expect(calls).toBe(2);
    expect(sameSelection([1, "a"], [1, "a"])).toBe(true);
    expect(sameSelection([1], [1, 2])).toBe(false);
  });
});
