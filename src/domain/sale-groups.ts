import { lineTotalCents } from "../core/money";
import type { Cents } from "../core/money";
import type { Product, Sale, SaleGroup, SaleItem } from "../core/types";

const CIGARROS = /cigarr|tabaco|marlboro|pall mall|delicados|camel\b|lucky strike/;
const CERVEZA = /cervez|caguama|tecate|corona|modelo|victoria|heineken|michelob|bohemia|indio\b/;

function plain(text: string): string {
  return text.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

/**
 * Grupo del producto para el corte. Si el producto tiene grupo explícito se
 * respeta; si no, se detecta por categoría (y luego por nombre).
 */
export function detectSaleGroup(product: Pick<Product, "name" | "category" | "sale_group"> | undefined): SaleGroup {
  if (!product) return "general";
  if (product.sale_group) return product.sale_group;
  const category = plain(product.category || "");
  if (CIGARROS.test(category)) return "cigarros";
  if (CERVEZA.test(category)) return "cerveza";
  const name = plain(product.name || "");
  if (CIGARROS.test(name)) return "cigarros";
  if (CERVEZA.test(name)) return "cerveza";
  return "general";
}

/** Grupo de una línea vendida: el guardado en la venta o, en ventas viejas, el del catálogo. */
export function itemGroup(item: SaleItem, productById: (id: string) => Product | undefined): SaleGroup {
  if (item.group) return item.group;
  return detectSaleGroup(productById(item.productId) ?? { name: item.name, category: "" });
}

/** Venta que cuenta como ingreso (la venta interna solo baja inventario). */
export function isRevenueSale(sale: Pick<Sale, "payment">): boolean {
  return sale.payment !== "interno";
}

export function isInternalSale(sale: Pick<Sale, "payment">): boolean {
  return sale.payment === "interno";
}

/** Total vendido por grupo (en centavos) de un conjunto de ventas con ingreso. */
export function groupTotalsCents(
  sales: readonly Sale[],
  productById: (id: string) => Product | undefined
): Record<SaleGroup, Cents> {
  const totals: Record<SaleGroup, Cents> = { general: 0, cigarros: 0, cerveza: 0 };
  for (const sale of sales) {
    if (!isRevenueSale(sale)) continue;
    for (const item of sale.items ?? []) {
      totals[itemGroup(item, productById)] += lineTotalCents(item.qty, item.price);
    }
  }
  return totals;
}
