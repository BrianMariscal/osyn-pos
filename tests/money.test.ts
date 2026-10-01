import { describe, expect, it } from "vitest";
import { fmtMoney, lineTotalCents, sumCents, toCents, toPesos } from "../src/core/money";

describe("money", () => {
  it("convierte pesos a centavos sin errores de flotante", () => {
    expect(toCents(0.1 + 0.2)).toBe(30);
    expect(toCents(18)).toBe(1800);
    expect(toCents("13.50")).toBe(1350);
    expect(toCents(undefined)).toBe(0);
    expect(toCents(Number.NaN)).toBe(0);
  });

  it("regresa pesos desde centavos", () => {
    expect(toPesos(1350)).toBe(13.5);
    expect(toPesos(1)).toBe(0.01);
  });

  it("total por línea: cantidad flotante x precio en pesos", () => {
    expect(lineTotalCents(2, 18)).toBe(3600);
    expect(lineTotalCents(0.5, 34)).toBe(1700);
    expect(lineTotalCents(3.333, 30)).toBe(9999); // 3.333 * 3000 = 9999
  });

  it("suma centavos de forma exacta", () => {
    expect(sumCents([1, 2, 3])).toBe(6);
    expect(sumCents([toCents(0.1), toCents(0.2)])).toBe(30);
  });

  it("formatea moneda MXN", () => {
    expect(fmtMoney(123456)).toContain("1,234.56");
  });
});
