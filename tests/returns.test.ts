import { describe, expect, it, beforeEach } from "vitest";
import { Store } from "../src/domain/store";
import { createInitialState, type AppState } from "../src/domain/app-state";
import { ChangeTracker } from "../src/data/change-tracker";
import { Repositories } from "../src/data/repositories";
import { BranchService } from "../src/domain/branch-service";
import { SaleService } from "../src/domain/sale-service";
import { ReturnService } from "../src/domain/return-service";
import { CreditService } from "../src/domain/credit-service";
import { ShiftService } from "../src/domain/shift-service";
import { ReportService } from "../src/domain/report-service";
import type { AuthService } from "../src/domain/auth-service";
import type { Sale } from "../src/core/types";
import { nowISO, todayStartISO } from "../src/core/dates";

function fakeAdminAuth(): AuthService {
  return {
    isAdmin: () => true,
    isOwner: () => true,
    assignedBranchId: () => null
  } as unknown as AuthService;
}

interface TestApp {
  store: Store<AppState>;
  repos: Repositories;
  sales: SaleService;
  returns: ReturnService;
  credit: CreditService;
  shifts: ShiftService;
  reports: ReportService;
}

function makeApp(): TestApp {
  const store = new Store<AppState>(createInitialState());
  const tracker = new ChangeTracker();
  const repos = new Repositories(store, tracker);
  const branches = new BranchService(store, fakeAdminAuth(), repos);
  branches.ensureSeeded();
  store.update((state) => {
    state.currentBranchId = "sucursal-1";
  });
  const sales = new SaleService(store, repos, branches);
  const returns = new ReturnService(store, repos, branches);
  const credit = new CreditService(repos);
  const shifts = new ShiftService(repos, branches);
  const reports = new ReportService(repos, store);
  const ts = nowISO();
  repos.products.upsert({ id: "jitomate", name: "Jitomate", category: "Frutas", um: "Kg", cost: 15, price: 25, active: true, updated_at: ts });
  repos.stocks.upsert({ id: "jitomate:sucursal-1", product_id: "jitomate", branch_id: "sucursal-1", stock: 10, min_stock: 0, updated_at: ts });
  repos.products.upsert({ id: "pan", name: "Pan", category: "", um: "Pza", cost: 4, price: 6, active: true, updated_at: ts });
  repos.stocks.upsert({ id: "pan:sucursal-1", product_id: "pan", branch_id: "sucursal-1", stock: 10, min_stock: 0, updated_at: ts });
  repos.products.upsert({ id: "coca", name: "Coca cola", category: "", um: "Pza", cost: 8, price: 12, pack_size: 12, pack_price: 120, active: true, updated_at: ts });
  repos.stocks.upsert({ id: "coca:sucursal-1", product_id: "coca", branch_id: "sucursal-1", stock: 24, min_stock: 0, updated_at: ts });
  return { store, repos, sales, returns, credit, shifts, reports };
}

function sell(app: TestApp, sales: Array<{ productId: string; qty: number; unit?: "pza" | "caja" }>, payment: "efectivo" | "tarjeta" | "fiado" | "interno", customerId: string | null = null): Sale {
  for (const line of sales) {
    const result = app.sales.addToCart(line.productId, line.qty, undefined, line.unit ?? "pza");
    expect(result.ok, result.ok ? "" : result.error).toBe(true);
  }
  const result = app.sales.completeSale({ payment, customerId });
  expect(result.ok, result.ok ? "" : result.error).toBe(true);
  if (!result.ok) throw new Error(result.error);
  return result.sale;
}

describe("devoluciones (return-service)", () => {
  let app: TestApp;

  beforeEach(() => {
    app = makeApp();
  });

  it("devuelve la venta completa: regresa el stock y no toca la venta original", () => {
    const sale = sell(app, [{ productId: "jitomate", qty: 2 }], "efectivo");
    expect(app.sales.stockOf("jitomate")).toBe(8);

    const pending = app.returns.pendingLines(sale);
    expect(pending).toHaveLength(1);
    expect(pending[0]?.pending).toBe(2);

    const result = app.returns.create({ saleId: sale.id, lines: [{ index: 0, qty: 2 }], payment: "efectivo", reason: "Se arrepintió" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.ret.total).toBe(50);
    expect(result.ret.cost).toBe(30);
    expect(result.ret.folio).toMatch(/^\d{6}-[A-Z0-9]{4}$/);
    expect(app.sales.stockOf("jitomate")).toBe(10);
    expect(app.returns.hasPending(sale)).toBe(false);
    expect(app.returns.returnsOf(sale.id)).toHaveLength(1);
    // La venta original sigue igual
    const stored = app.repos.sales.byId(sale.id);
    expect(stored?.total).toBe(50);
    expect(stored?.deleted).toBeFalsy();
  });

  it("devuelve solo una parte y topa la cantidad pendiente", () => {
    const sale = sell(app, [{ productId: "jitomate", qty: 2 }], "efectivo");
    const partial = app.returns.create({ saleId: sale.id, lines: [{ index: 0, qty: 0.5 }], payment: "efectivo", reason: "Producto dañado" });
    expect(partial.ok).toBe(true);
    if (!partial.ok) return;
    expect(partial.ret.total).toBe(12.5);
    expect(app.sales.stockOf("jitomate")).toBe(8.5);
    expect(app.returns.pendingLines(sale)[0]?.pending).toBe(1.5);

    const tooMuch = app.returns.create({ saleId: sale.id, lines: [{ index: 0, qty: 2 }], payment: "efectivo", reason: "Otro" });
    expect(tooMuch.ok).toBe(false);
    if (!tooMuch.ok) expect(tooMuch.error).toContain("solo quedan");

    const rest = app.returns.create({ saleId: sale.id, lines: [{ index: 0, qty: 1.5 }], payment: "efectivo", reason: "Otro" });
    expect(rest.ok).toBe(true);
    expect(app.sales.stockOf("jitomate")).toBe(10);
    expect(app.returns.pendingLines(sale)[0]?.pending).toBe(0);
  });

  it("una caja devuelta regresa todas sus piezas al inventario", () => {
    const sale = sell(app, [{ productId: "coca", qty: 1, unit: "caja" }], "efectivo");
    expect(sale.total).toBe(120);
    expect(app.sales.stockOf("coca")).toBe(12);
    expect(sale.items[0]?.pack_size).toBe(12);

    const result = app.returns.create({ saleId: sale.id, lines: [{ index: 0, qty: 1 }], payment: "efectivo", reason: "Error de cobro" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.ret.total).toBe(120);
    expect(result.ret.cost).toBe(96);
    expect(app.sales.stockOf("coca")).toBe(24);
  });

  it("el abono a fiado baja el saldo y deja movimiento de devolución", () => {
    const ts = nowISO();
    app.repos.customers.upsert({ id: "cliente-1", branch_id: "sucursal-1", name: "Rosa", phone: "", notes: "", balance: 0, movements: [], created_at: ts, updated_at: ts });
    const sale = sell(app, [{ productId: "jitomate", qty: 2 }], "fiado", "cliente-1");
    expect(app.repos.customers.byId("cliente-1")?.balance).toBe(50);

    const result = app.returns.create({ saleId: sale.id, lines: [{ index: 0, qty: 2 }], payment: "fiado", reason: "Se arrepintió", cashier: "Ana" });
    expect(result.ok).toBe(true);
    const customer = app.repos.customers.byId("cliente-1");
    expect(customer?.balance).toBe(0);
    const movement = customer?.movements[0];
    expect(movement?.type).toBe("devolucion");
    expect(movement?.amount).toBe(50);
    expect(movement?.sale_id).toBe(sale.id);
    if (result.ok) expect(movement?.return_id).toBe(result.ret.id);
  });

  it("si el abono supera el saldo, avisa y deja el saldo en cero", () => {
    const ts = nowISO();
    app.repos.customers.upsert({ id: "cliente-1", branch_id: "sucursal-1", name: "Rosa", phone: "", notes: "", balance: 0, movements: [], created_at: ts, updated_at: ts });
    const sale = sell(app, [{ productId: "jitomate", qty: 2 }], "fiado", "cliente-1");
    const customer = app.repos.customers.byId("cliente-1")!;
    app.repos.customers.upsert({ ...customer, balance: 10, updated_at: nowISO() });

    const result = app.returns.create({ saleId: sale.id, lines: [{ index: 0, qty: 2 }], payment: "fiado", reason: "Se arrepintió" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.warning).toContain("a su favor");
    expect(app.repos.customers.byId("cliente-1")?.balance).toBe(0);
  });

  it("no se pueden devolver ventas de uso interno", () => {
    const sale = sell(app, [{ productId: "pan", qty: 2 }], "interno");
    expect(app.returns.hasPending(sale)).toBe(false);
    const result = app.returns.create({ saleId: sale.id, lines: [{ index: 0, qty: 1 }], payment: "efectivo", reason: "Otro" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("uso interno");
  });

  it("exige elegir al menos un producto y un renglón válido", () => {
    const sale = sell(app, [{ productId: "pan", qty: 1 }], "efectivo");
    const empty = app.returns.create({ saleId: sale.id, lines: [], payment: "efectivo", reason: "Otro" });
    expect(empty.ok).toBe(false);
    if (!empty.ok) expect(empty.error).toContain("al menos un producto");
    const badIndex = app.returns.create({ saleId: sale.id, lines: [{ index: 7, qty: 1 }], payment: "efectivo", reason: "Otro" });
    expect(badIndex.ok).toBe(false);
  });

  it("rechaza renglones repetidos de la misma venta", () => {
    const sale = sell(app, [{ productId: "pan", qty: 2 }], "efectivo");
    const result = app.returns.create({
      saleId: sale.id,
      lines: [{ index: 0, qty: 1 }, { index: 0, qty: 1 }],
      payment: "efectivo",
      reason: "Otro"
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("repetido");
  });
});

describe("devoluciones en corte y reportes", () => {
  let app: TestApp;

  beforeEach(() => {
    app = makeApp();
  });

  it("el corte descuenta el reembolso en efectivo y baja la ganancia", () => {
    const sale = sell(app, [{ productId: "jitomate", qty: 2 }], "efectivo");
    const before = app.shifts.summarize("sucursal-1");
    expect(before.ventas).toBe(50);
    expect(before.efectivoEsperado).toBe(50);
    expect(before.ganancia).toBe(20);

    const cash = app.returns.create({ saleId: sale.id, lines: [{ index: 0, qty: 0.5 }], payment: "efectivo", reason: "Producto dañado" });
    expect(cash.ok).toBe(true);
    const afterCash = app.shifts.summarize("sucursal-1");
    expect(afterCash.devoluciones).toBe(12.5);
    expect(afterCash.devolucionesEfectivo).toBe(12.5);
    expect(afterCash.efectivoEsperado).toBe(37.5);
    expect(afterCash.ganancia).toBe(15);

    // Un reembolso por tarjeta baja la ganancia pero NO el efectivo esperado.
    const card = app.returns.create({ saleId: sale.id, lines: [{ index: 0, qty: 0.5 }], payment: "tarjeta", reason: "Producto dañado" });
    expect(card.ok).toBe(true);
    const afterCard = app.shifts.summarize("sucursal-1");
    expect(afterCard.devoluciones).toBe(25);
    expect(afterCard.devolucionesEfectivo).toBe(12.5);
    expect(afterCard.efectivoEsperado).toBe(37.5);
    expect(afterCard.ganancia).toBe(10);
  });

  it("el reporte del periodo resta el margen devuelto", () => {
    const sale = sell(app, [{ productId: "jitomate", qty: 2 }], "efectivo");
    const result = app.returns.create({ saleId: sale.id, lines: [{ index: 0, qty: 1 }], payment: "efectivo", reason: "Producto dañado" });
    expect(result.ok).toBe(true);
    const end = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    const report = app.reports.periodReport("sucursal-1", todayStartISO(), end);
    expect(report.sales_total).toBe(50);
    expect(report.sales_cost).toBe(30);
    expect(report.returns_total).toBe(25);
    expect(report.returns_cost).toBe(15);
    expect(report.returns_count).toBe(1);
    expect(report.profit_after_expenses).toBe(10);
  });

  it("la devolución llega a la sucursal correcta y se puede sincronizar", () => {
    const sale = sell(app, [{ productId: "pan", qty: 1 }], "efectivo");
    const result = app.returns.create({ saleId: sale.id, lines: [{ index: 0, qty: 1 }], payment: "efectivo", reason: "Otro" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.ret.branch_id).toBe("sucursal-1");
    expect(app.repos.returns.byId(result.ret.id)?.total).toBe(6);
  });

  it("los abonos de fiado en efectivo entran al corte", () => {
    const ts = nowISO();
    app.repos.customers.upsert({ id: "cliente-1", branch_id: "sucursal-1", name: "Rosa", phone: "", notes: "", balance: 0, movements: [], created_at: ts, updated_at: ts });
    sell(app, [{ productId: "jitomate", qty: 2 }], "fiado", "cliente-1");
    // La venta fiado no es efectivo, pero la cobranza sí llega a la caja.
    const before = app.shifts.summarize("sucursal-1");
    expect(before.abonos).toBe(0);
    expect(before.efectivoEsperado).toBe(0);

    const pay = app.credit.pay("cliente-1", 20);
    expect(pay.ok).toBe(true);
    const after = app.shifts.summarize("sucursal-1");
    expect(after.abonos).toBe(20);
    expect(after.efectivoEsperado).toBe(20);
    expect(app.repos.customers.byId("cliente-1")?.balance).toBe(30);
  });
});
