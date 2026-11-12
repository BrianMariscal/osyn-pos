import { describe, expect, it, beforeEach } from "vitest";
import { Store } from "../src/domain/store";
import { createInitialState, type AppState } from "../src/domain/app-state";
import { ChangeTracker } from "../src/data/change-tracker";
import { Repositories } from "../src/data/repositories";
import { BranchService } from "../src/domain/branch-service";
import { ShiftService } from "../src/domain/shift-service";
import { dayRange, nowISO, toInputDateValue } from "../src/core/dates";
import type { AuthService } from "../src/domain/auth-service";
import type { Sale } from "../src/core/types";

function fakeAdminAuth(): AuthService {
  return { isAdmin: () => true, isOwner: () => true, assignedBranchId: () => null } as unknown as AuthService;
}

const BRANCH = "sucursal-1";

/** Fecha local a N días de hoy (negativo = pasado) con la hora indicada. */
function at(offsetDays: number, hours: number): string {
  const base = new Date();
  const date = new Date(base.getFullYear(), base.getMonth(), base.getDate() + offsetDays, hours, 0, 0, 0);
  return date.toISOString();
}

function day(offsetDays: number): string {
  const base = new Date();
  return toInputDateValue(new Date(base.getFullYear(), base.getMonth(), base.getDate() + offsetDays));
}

describe("cortes por rango, de días pasados y automáticos", () => {
  let store: Store<AppState>;
  let repos: Repositories;
  let branches: BranchService;
  let shifts: ShiftService;

  const seedSale = (id: string, createdAt: string, total = 100): void => {
    const sale: Sale = {
      id,
      branch_id: BRANCH,
      items: [{ productId: "p1", name: "Coca 600", qty: 1, price: total, cost: total * 0.6, um: "Pza", group: "general" }],
      total,
      cost: total * 0.6,
      profit: total * 0.4,
      payment: "efectivo",
      customer_id: null,
      created_at: createdAt,
      updated_at: createdAt
    };
    repos.sales.upsert(sale);
  };

  beforeEach(() => {
    store = new Store<AppState>(createInitialState());
    repos = new Repositories(store, new ChangeTracker());
    branches = new BranchService(store, fakeAdminAuth(), repos);
    branches.ensureSeeded();
    store.update((state) => {
      state.currentBranchId = BRANCH;
    });
    shifts = new ShiftService(repos, branches);
  });

  it("resume un día pasado y lo cierra sin tocar las ventas de hoy", () => {
    seedSale("a1", at(-11, 10), 100);
    seedSale("a2", at(-11, 17), 50);
    seedSale("b1", at(-10, 12), 200);
    seedSale("hoy", nowISO(), 77);

    const infoA = shifts.dayInfo(BRANCH, day(-11));
    expect(infoA.alreadyClosed).toBe(false);
    expect(infoA.summary.ventas).toBe(150);
    expect(infoA.end).toBe(dayRange(day(-11)).end);

    const resultA = shifts.closeDay(day(-11), {
      opening_cash: 0,
      counted_cash: infoA.summary.efectivoEsperado,
      withdrawn_cash: 0,
      next_opening_cash: 0,
      notes: "Prueba"
    });
    expect(resultA.ok).toBe(true);
    if (!resultA.ok) return;
    expect(resultA.shift.summary.ventas).toBe(150);
    expect(resultA.shift.closed_at).toBe(dayRange(day(-11)).end);
    expect(resultA.shift.difference).toBe(0);

    // El día siguiente arranca desde el corte anterior y no incluye días viejos.
    const infoB = shifts.dayInfo(BRANCH, day(-10));
    expect(infoB.summary.ventas).toBe(200);
    const resultB = shifts.closeDay(day(-10), {
      opening_cash: 0,
      counted_cash: infoB.summary.efectivoEsperado,
      withdrawn_cash: 0,
      next_opening_cash: 0,
      notes: ""
    });
    expect(resultB.ok).toBe(true);

    // Las ventas de hoy siguen intactas para el siguiente corte.
    expect(shifts.summarize(BRANCH).ventas).toBe(77);
    expect(shifts.lastShift(BRANCH)?.summary.ventas).toBe(200);
  });

  it("el retiro de caja no genera un faltante falso", () => {
    seedSale("retiro", nowISO(), 100);

    // Contado $50 + retirado $50 = $100 esperados.
    const shift = shifts.closeShift({
      opening_cash: 0,
      counted_cash: 50,
      withdrawn_cash: 50,
      next_opening_cash: 0,
      notes: ""
    });

    expect(shift.difference).toBe(0);
    expect(shift.distribution_difference).toBe(0);
  });

  it("no deja cerrar un día ya cerrado ni uno sin movimientos", () => {
    seedSale("a1", at(-5, 12), 100);
    const info = shifts.dayInfo(BRANCH, day(-5));
    const first = shifts.closeDay(day(-5), {
      opening_cash: 0,
      counted_cash: info.summary.efectivoEsperado,
      withdrawn_cash: 0,
      next_opening_cash: 0,
      notes: ""
    });
    expect(first.ok).toBe(true);

    const again = shifts.closeDay(day(-5), { opening_cash: 0, counted_cash: 0, withdrawn_cash: 0, next_opening_cash: 0, notes: "" });
    expect(again.ok).toBe(false);
    if (!again.ok) expect(again.error).toContain("ya tiene un corte");

    const empty = shifts.closeDay(day(-4), { opening_cash: 0, counted_cash: 0, withdrawn_cash: 0, next_opening_cash: 0, notes: "" });
    expect(empty.ok).toBe(false);
    if (!empty.ok) expect(empty.error).toContain("no tuvo movimientos");
  });

  it("cierra solo el día de ayer a medianoche si no se hizo manualmente", () => {
    seedSale("ayer", at(-1, 12), 150);

    const auto = shifts.autoCloseIfNeeded(BRANCH);
    expect(auto).not.toBeNull();
    if (!auto) return;
    expect(auto.summary.ventas).toBe(150);
    expect(auto.closed_at).toBe(dayRange(day(-1)).end);
    expect(auto.difference).toBe(0);
    // Sin retiro, todo el efectivo queda como base del día siguiente.
    expect(auto.next_opening_cash).toBe(150);
    expect(auto.distribution_difference).toBe(0);
    // Idempotente: una segunda pasada no duplica el corte.
    expect(shifts.autoCloseIfNeeded(BRANCH)).toBeNull();
  });

  it("respeta el apagado por sucursal y no cierra días sin movimientos", () => {
    expect(shifts.autoCloseIfNeeded(BRANCH)).toBeNull(); // sin movimientos ayer

    seedSale("ayer", at(-1, 12), 150);
    branches.update(BRANCH, { auto_close: false });
    expect(shifts.autoCloseIfNeeded(BRANCH)).toBeNull();

    // Con el cierre manual de ayer hecho, el automático tampoco se repite.
    branches.update(BRANCH, { auto_close: true });
    const info = shifts.dayInfo(BRANCH, day(-1));
    const manual = shifts.closeDay(day(-1), {
      opening_cash: 0,
      counted_cash: info.summary.efectivoEsperado,
      withdrawn_cash: 0,
      next_opening_cash: 0,
      notes: ""
    });
    expect(manual.ok).toBe(true);
    expect(shifts.autoCloseIfNeeded(BRANCH)).toBeNull();
  });
});
