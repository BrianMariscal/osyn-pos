import { describe, expect, it } from "vitest";
import { matchesCategoryFilter, matchesSupplierFilter, searchProducts } from "../src/domain/catalog";
import { planProductImport, planSupplierImport, productExportRows } from "../src/domain/product-transfer";
import type { Product, Supplier } from "../src/core/types";

const ts = "2026-10-05T12:00:00.000Z";
const p = (id: string, name: string, extra: Partial<Product> = {}): Product => ({
  id, name, category: "Refrescos", um: "Pza", cost: 10, price: 15, active: true, updated_at: ts, ...extra
});
const coke: Supplier = { id: "s1", number: 1, name: "Coca Cola", type: "Refrescos", phone: "555", notes: "", updated_at: ts };
const products = [
  p("a", "Coca Cola 3L", { supplier_id: "s1", barcode: "7501055300075" }),
  p("b", "Coca Cola 600 ml", { supplier_id: "s1" }),
  p("c", "Sprite 2L", { supplier_id: "s1" }),
  p("d", "Fanta Naranja", { supplier_id: "s1" }),
  p("e", "Pan Bimbo", { category: "Pan" }),
  p("f", "Empanadas", { category: "Pan" })
];
const supplierOf = (x: Product) => (x.supplier_id === "s1" ? coke : undefined);
const ids = (list: Product[]) => list.map((x) => x.id);

describe("búsqueda de productos", () => {
  it("busca por nombre, no muestra todo el proveedor", () => {
    expect(ids(searchProducts(products, "coca cola", supplierOf))).toEqual(["a", "b"]);
    expect(ids(searchProducts(products, "Coca Cola 3l", supplierOf))).toEqual(["a"]);
    expect(ids(searchProducts(products, "cocacola 3l", supplierOf))).toEqual(["a"]);
  });
  it("prioriza inicio de palabra sobre texto intermedio", () => {
    expect(ids(searchProducts(products, "pan", supplierOf))).toEqual(["e"]);
    expect(ids(searchProducts(products, "panad", supplierOf))).toEqual(["f"]);
  });
  it("código de barras, número de proveedor y proveedor como último recurso", () => {
    expect(ids(searchProducts(products, "7501055300075", supplierOf))).toEqual(["a"]);
    expect(ids(searchProducts(products, "#1", supplierOf))).toEqual(["a", "b", "d", "c"]);
    expect(ids(searchProducts(products, "refrescos", supplierOf))).toEqual(["a", "b", "d", "c"]);
  });
  it("filtros de proveedor y categoría", () => {
    const existing = new Set(["s1"]);
    expect(products.filter((x) => matchesSupplierFilter(x, "none", existing)).map((x) => x.id)).toEqual(["e", "f"]);
    expect(products.filter((x) => matchesCategoryFilter(x, "pan")).map((x) => x.id)).toEqual(["e", "f"]);
  });
});

describe("exportar / importar", () => {
  it("exporta todos los datos y se reimporta igual", () => {
    const rows = productExportRows([products[0]!, { ...products[4]!, pack_size: 12, pack_price: 150, sale_group: "general" }], {
      suppliers: new Map([["s1", coke]]),
      stockOf: (id) => (id === "a" ? { stock: 7, min_stock: 2 } : undefined),
      branchName: "Centro"
    }).map((row) => row.map(String));
    expect(rows[0]).toContain("proveedor");
    const plan = planProductImport({ rows, products: [], suppliers: [], stocks: [], branchId: "b1", now: ts, newId: () => "new" });
    expect(plan.created).toBe(2);
    const coca = plan.products.find((x) => x.id === "a")!;
    expect(coca.barcode).toBe("7501055300075");
    expect(coca.category).toBe("Refrescos");
    expect(plan.suppliers).toHaveLength(1);
    expect(plan.suppliers[0]!.name).toBe("Coca Cola");
    expect(coca.supplier_id).toBe(plan.suppliers[0]!.id);
    expect(plan.products.find((x) => x.id === "e")!.pack_size).toBe(12);
    expect(plan.products.find((x) => x.id === "e")!.pack_price).toBe(150);
    expect(plan.stocks.find((s) => s.product_id === "a")).toMatchObject({ stock: 7, min_stock: 2, branch_id: "b1" });
  });
  it("acepta la plantilla anterior", () => {
    const rows = [
      ["nombre", "categoria", "um", "costo", "precio", "existencia", "minimo", "codigo", "piezas_caja"],
      ["Azúcar", "Abarrotes", "Kg", "22", "30", "25.5", "5", "", ""]
    ];
    const plan = planProductImport({ rows, products: [], suppliers: [], stocks: [], branchId: "b1", now: ts, newId: () => "x" });
    expect(plan.products[0]).toMatchObject({ name: "Azúcar", um: "Kg", cost: 22, price: 30 });
    expect(plan.stocks[0]).toMatchObject({ stock: 25.5, min_stock: 5 });
  });
  it("importa proveedores actualizando por nombre", () => {
    const rows = [["numero", "nombre", "giro", "telefono"], ["", "coca cola", "Bebidas", "999"], ["", "Sabritas", "Botanas", ""]];
    let n = 0;
    const plan = planSupplierImport(rows, [coke], ts, () => `n${++n}`);
    expect(plan.updated).toBe(1);
    expect(plan.created).toBe(1);
    expect(plan.suppliers.find((s) => s.id === "s1")).toMatchObject({ type: "Bebidas", phone: "999", number: 1 });
    expect(plan.suppliers.find((s) => s.name === "Sabritas")!.number).toBe(2);
  });
});
