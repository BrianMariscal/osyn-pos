import { describe, expect, it } from "vitest";
import { dayRange, monthRange, rowTime, todayInputValue } from "../src/core/dates";
import { normalizeQty } from "../src/core/qty";

describe("qty", () => {
  it("redondea a 2 decimales", () => {
    expect(normalizeQty("2.5")).toBe(2.5);
    expect(normalizeQty(1.23456)).toBe(1.23);
    expect(normalizeQty(-5)).toBe(0);
    expect(normalizeQty("abc")).toBe(0);
  });
});

describe("dates", () => {
  it("rango del día es [medianoche local, medianoche siguiente)", () => {
    const { start, end } = dayRange("2026-09-04");
    expect(new Date(start).getHours()).toBe(0);
    expect(new Date(start).getMinutes()).toBe(0);
    expect(new Date(end).getDate()).toBe(5);
  });

  it("rango del mes cubre el mes completo", () => {
    const { start, end } = monthRange("2026-02");
    expect(new Date(start).getDate()).toBe(1);
    expect(new Date(end).getMonth()).toBe(2); // marzo = fin exclusivo
    expect(new Date(end).getDate()).toBe(1);
  });

  it("todayInputValue devuelve fecha local ISO corta", () => {
    expect(todayInputValue()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("rowTime ignora filas sin fecha", () => {
    expect(rowTime({})).toBe(0);
    expect(rowTime({ updated_at: "2026-01-02T00:00:00Z" })).toBeGreaterThan(0);
  });
});
