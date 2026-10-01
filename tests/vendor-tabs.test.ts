import { describe, expect, it } from "vitest";
import { normalizeVendorTabs } from "../src/domain/normalize";

describe("normalización de pestañas del vendedor", () => {
  it("migra el default viejo (venta+fiado) al nuevo default con corte", () => {
    expect(normalizeVendorTabs(["venta", "fiado"])).toEqual([
      "inicio",
      "venta",
      "fiado",
      "corte",
      "mermas",
      "entradas"
    ]);
  });

  it("migra aunque vengan en otro orden", () => {
    expect(normalizeVendorTabs(["fiado", "venta"])).toEqual([
      "inicio",
      "venta",
      "fiado",
      "corte",
      "mermas",
      "entradas"
    ]);
  });

  it("respeta la configuración personalizada del admin", () => {
    expect(normalizeVendorTabs(["venta", "corte"])).toEqual(["venta", "corte"]);
  });

  it("cae al default con valores vacíos o inválidos", () => {
    expect(normalizeVendorTabs([])).toHaveLength(6);
    expect(normalizeVendorTabs("basura")).toContain("venta");
    expect(normalizeVendorTabs(["no-existe"])).toHaveLength(6);
  });
});
