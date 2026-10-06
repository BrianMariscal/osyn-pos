import { describe, expect, it } from "vitest";
import { cashChange, quickCashOptions, saleFolio, ticketText } from "../src/domain/ticket";
import type { Sale } from "../src/core/types";

const sale: Sale = {
  id: "abc-123-xyz9",
  branch_id: "s1",
  items: [{ productId: "p1", name: "Coca Cola 600 ml", qty: 2, price: 18, cost: 13, um: "Pza" }],
  total: 36,
  cost: 26,
  profit: 10,
  payment: "efectivo",
  customer_id: null,
  cash_received: 50,
  change: 14,
  created_at: new Date(2026, 9, 6, 14, 30).toISOString(),
  updated_at: ""
};

describe("ticket", () => {
  it("folio con fecha local y final del id", () => {
    expect(saleFolio(sale)).toBe("261006-XYZ9");
  });
  it("calcula cambio o faltante", () => {
    expect(cashChange(3600, "50")).toEqual({ status: "ok", changeCents: 1400 });
    expect(cashChange(3600, "20")).toEqual({ status: "short", missingCents: 1600 });
    expect(cashChange(3600, "")).toEqual({ status: "empty" });
    expect(cashChange(3600, "36")).toEqual({ status: "ok", changeCents: 0 });
  });
  it("sugiere billetes que cubren el total", () => {
    expect(quickCashOptions(3600)).toEqual([40, 50, 100, 200]);
    expect(quickCashOptions(45000)).toEqual([500, 1000]);
    expect(quickCashOptions(45500)).toEqual([460, 500, 1000]);
  });
  it("texto del ticket con total y cambio", () => {
    const text = ticketText(sale, "Abarrotes Mariscal");
    expect(text).toContain("Abarrotes Mariscal");
    expect(text).toContain("Total: $36.00");
    expect(text).toContain("Cambio: $14.00");
  });
});
