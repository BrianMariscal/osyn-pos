import { describe, expect, it } from "vitest";
import { normalizeState } from "../src/domain/normalize";
import { findProductByBarcode } from "../src/domain/voice/product-matcher";
import type { Product } from "../src/core/types";

const legacyRaw = {
  products: [
    { id: "p1", name: "Coca 600 ml", category: "Refrescos", um: "Pza", cost: 13, price: 18, stock: 10, min_stock: 2, active: true, updated_at: "2026-01-01T00:00:00Z" },
    { id: "p2", name: "Leche 1L", um: "Pza", cost: 21, price: 28, stock: 4, min_stock: 1, active: true, updated_at: "2026-01-01T00:00:00Z" },
    { id: "p3", name: "Pan", um: "Pza", cost: 5, price: 8, stock: 0, active: true, updated_at: "2026-01-01T00:00:00Z" }
  ],
  product_stocks: [],
  settings: { storeName: "FMM" }
};

describe("respaldo legacy sin product_stocks", () => {
  it("sintetiza existencias de Sucursal 1 desde products.stock", () => {
    const state = normalizeState(legacyRaw);
    expect(state.product_stocks).toHaveLength(2); // p3 tiene stock 0 → sin fila
    const coca = state.product_stocks.find((s) => s.product_id === "p1");
    expect(coca?.branch_id).toBe("sucursal-1");
    expect(coca?.stock).toBe(10);
    expect(coca?.min_stock).toBe(2);
  });

  it("no altera respaldos que ya traen product_stocks", () => {
    const state = normalizeState({
      ...legacyRaw,
      product_stocks: [{ id: "p1:sucursal-1", product_id: "p1", branch_id: "sucursal-1", stock: 3, min_stock: 1, updated_at: "2026-01-02T00:00:00Z" }]
    });
    expect(state.product_stocks).toHaveLength(1);
    expect(state.product_stocks[0]?.stock).toBe(3);
  });

  it("mantiene el nombre de la tienda del respaldo", () => {
    expect(normalizeState(legacyRaw).settings.storeName).toBe("FMM");
  });
});

describe("código de barras", () => {
  const products = normalizeState(legacyRaw).products;
  const withCode: Product[] = products
    .filter((p) => p.id === "p1")
    .map((p) => ({ ...p, barcode: "7501234567890" }));

  it("encuentra el producto por código exacto (con espacios)", () => {
    expect(findProductByBarcode(withCode, "7501234567890")?.id).toBe("p1");
    expect(findProductByBarcode(withCode, "  7501234567890  ")?.id).toBe("p1");
  });

  it("ignora códigos desconocidos y productos sin código", () => {
    expect(findProductByBarcode(withCode, "9999999999999")).toBeUndefined();
    expect(findProductByBarcode(products, "7501234567890")).toBeUndefined();
    expect(findProductByBarcode(withCode, "")).toBeUndefined();
  });
});
