import { describe, expect, it } from "vitest";
import { isPayroll, payrollProgress, weeklyCents } from "../src/domain/expense-service";

describe("meta de nómina", () => {
  it("reconoce sueldos por categoría o concepto", () => {
    expect(isPayroll({ category: "Sueldos", concept: "Juan" })).toBe(true);
    expect(isPayroll({ category: "Varios", concept: "Nómina semanal" })).toBe(true);
    expect(isPayroll({ category: "Renta", concept: "Local" })).toBe(false);
  });
  it("pasa montos mensuales a semana", () => {
    expect(weeklyCents({ amount: 2000, period: "semanal" })).toBe(200000);
    expect(weeklyCents({ amount: 5200, period: "mensual" })).toBe(120000);
  });
  it("calcula lo que falta y cuánto por día (miércoles: quedan 5 días)", () => {
    const wednesday = new Date(2026, 9, 7, 12);
    const p = payrollProgress(300000, 100000, wednesday);
    expect(p.daysLeft).toBe(5);
    expect(p.missing).toBe(200000);
    expect(p.perDay).toBe(40000);
    expect(p.progress).toBe(33);
    expect(payrollProgress(300000, 350000, wednesday)).toMatchObject({ missing: 0, perDay: 0, progress: 100 });
  });
});
