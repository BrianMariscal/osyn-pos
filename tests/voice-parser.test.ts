import { describe, expect, it } from "vitest";
import { parseVoiceSale, voiceNumber } from "../src/domain/voice/voice-parser";
import { findProductByVoice, matchOrdersToProducts } from "../src/domain/voice/product-matcher";
import type { Product } from "../src/core/types";

const products: Product[] = [
  { id: "p1", name: "Coca Cola 600 ml", category: "Refrescos", um: "Pza", cost: 13, price: 18, active: true, updated_at: "" },
  { id: "p2", name: "Leche entera 1L", category: "Lácteos", um: "Pza", cost: 21, price: 28, active: true, updated_at: "" },
  { id: "p3", name: "Pan dulce", category: "Pan", um: "Pza", cost: 5, price: 8, active: true, updated_at: "" }
];

describe("voice-parser", () => {
  it("interpreta cantidades numéricas y en palabras", () => {
    expect(voiceNumber("2")).toBe(2);
    expect(voiceNumber("dos")).toBe(2);
    expect(voiceNumber("medio")).toBe(0.5);
    expect(voiceNumber("x")).toBeNull();
  });

  it("parsea una frase con varios productos", () => {
    const orders = parseVoiceSale("dos coca colas, una leche y tres panes");
    expect(orders).toHaveLength(3);
    expect(orders[0]?.qty).toBe(2);
    expect(orders[1]?.qty).toBe(1);
    expect(orders[2]?.qty).toBe(3);
  });

  it("ignora verbos de comando", () => {
    const orders = parseVoiceSale("agrega dos coca colas");
    expect(orders[0]?.name).toContain("coca");
    expect(orders[0]?.qty).toBe(2);
  });
});

describe("product-matcher", () => {
  it("encuentra por coincidencia parcial", () => {
    expect(findProductByVoice("coca", products)?.id).toBe("p1");
    expect(findProductByVoice("pan dulce", products)?.id).toBe("p3");
    expect(findProductByVoice("inexistente total", products)).toBeUndefined();
  });

  it("matchea órdenes de IA validando contra el catálogo real", () => {
    const result = matchOrdersToProducts(
      [
        { product_id: "p1", name: "Coca", qty: 2 },
        { product_id: "inventado", name: "Coca", qty: 1 },
        { name: "leche", qty: 1.5 },
        { name: "cosa rara", qty: 1 }
      ],
      products
    );
    // id válido → p1; id inventado con nombre válido → fallback por nombre → p1; leche por nombre
    expect(result.matched).toHaveLength(3);
    expect(result.matched[0]?.product.id).toBe("p1");
    expect(result.matched[1]?.product.id).toBe("p1");
    expect(result.matched[2]?.qty).toBe(1.5);
    expect(result.notFound).toEqual(["cosa rara"]);
  });
});
