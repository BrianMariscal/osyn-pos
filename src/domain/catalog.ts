import type { Product, Supplier } from "../core/types";

/** Prefijo del contenido de las etiquetas QR que imprime la app para productos sin código de barras. */
export const PRODUCT_QR_PREFIX = "POS:";

function plain(text: string): string {
  return text.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
}

/** Siguiente número de proveedor (consecutivo, nunca reutiliza uno existente). */
export function nextSupplierNumber(suppliers: readonly Supplier[]): number {
  return suppliers.reduce((max, supplier) => Math.max(max, Number(supplier.number) || 0), 0) + 1;
}

/**
 * Proveedores que aún no tienen número: se les asigna en orden de alta.
 * Devuelve solo los que cambiaron (para guardarlos).
 */
export function assignMissingSupplierNumbers(suppliers: readonly Supplier[]): Supplier[] {
  const missing = suppliers
    .filter((supplier) => !supplier.deleted && !(Number(supplier.number) > 0))
    .sort((a, b) => (a.created_at || a.updated_at || "").localeCompare(b.created_at || b.updated_at || ""));
  let next = nextSupplierNumber(suppliers);
  return missing.map((supplier) => ({ ...supplier, number: next++ }));
}

export function supplierCode(supplier: Pick<Supplier, "number"> | undefined): string {
  const n = Number(supplier?.number) || 0;
  return n > 0 ? `#${String(n).padStart(2, "0")}` : "";
}

export function supplierLabel(supplier: Supplier | undefined): string {
  if (!supplier) return "";
  const code = supplierCode(supplier);
  return code ? `${code} · ${supplier.name}` : supplier.name;
}

/**
 * Búsqueda de producto para venta/listados: nombre, categoría, código de
 * barras, proveedor (nombre o giro) y número de proveedor ("#3" o "3").
 */
export function productMatches(product: Product, query: string, supplier?: Supplier): boolean {
  const q = plain(query);
  if (!q) return true;
  if (product.barcode && product.barcode.trim() === query.trim()) return true;
  // "#3" busca por número de proveedor
  const byNumber = /^#(\d+)$/.exec(q);
  if (byNumber) return (Number(supplier?.number) || 0) === Number(byNumber[1]);
  const haystack = plain(`${product.name} ${product.category || ""} ${supplier?.name ?? ""} ${supplier?.type ?? ""}`);
  return q.split(/\s+/).every((word) => haystack.includes(word));
}

/** Texto que se codifica en el QR de un producto (su código de barras o su id). */
export function productQrPayload(product: Pick<Product, "id" | "barcode">): string {
  return product.barcode?.trim() || `${PRODUCT_QR_PREFIX}${product.id}`;
}

/**
 * Resuelve lo leído por el escáner (código de barras o QR) a un producto:
 * código de barras exacto, QR de la app ("POS:<id>"), id directo o nombre exacto.
 */
export function resolveScannedCode(products: readonly Product[], raw: string): Product | undefined {
  const code = raw.trim();
  if (!code) return undefined;
  const sellable = products.filter((product) => product.active !== false && !product.deleted);
  const byBarcode = sellable.find((product) => product.barcode && product.barcode.trim() === code);
  if (byBarcode) return byBarcode;
  const id = code.toUpperCase().startsWith(PRODUCT_QR_PREFIX) ? code.slice(PRODUCT_QR_PREFIX.length).trim() : code;
  const byId = sellable.find((product) => product.id === id);
  if (byId) return byId;
  const name = plain(code);
  return sellable.find((product) => plain(product.name) === name);
}
