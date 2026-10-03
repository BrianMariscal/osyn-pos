import { toCents, toPesos } from "../core/money";
import type { Product, Sale, Supplier } from "../core/types";

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

/** Productos que se pueden comprar a un proveedor: solo los suyos (sin proveedor elegido = todos). */
export function productsForSupplier<T extends Pick<Product, "supplier_id">>(products: readonly T[], supplierId: string): T[] {
  return supplierId ? products.filter((product) => product.supplier_id === supplierId) : [...products];
}

/** Categorías sugeridas aunque aún no haya productos con ellas. */
export const BASE_CATEGORIES = [
  "Abarrotes",
  "Refrescos",
  "Cerveza",
  "Cigarros",
  "Lácteos",
  "Botanas",
  "Dulces",
  "Pan",
  "Limpieza",
  "Higiene",
  "Frutas y verduras"
] as const;

/**
 * Categorías para elegir en un producto: las base, las ya usadas y el giro de
 * cada proveedor (así un proveedor de "Mascotas" agrega esa categoría).
 */
export function categoryOptions(products: readonly Pick<Product, "category">[], suppliers: readonly Pick<Supplier, "type" | "deleted">[]): string[] {
  const byKey = new Map<string, string>();
  const add = (value: string | undefined): void => {
    const clean = (value ?? "").trim();
    if (!clean) return;
    const key = plain(clean);
    if (!byKey.has(key)) byKey.set(key, clean);
  };
  BASE_CATEGORIES.forEach(add);
  products.forEach((product) => add(product.category));
  suppliers.filter((supplier) => !supplier.deleted).forEach((supplier) => add(supplier.type));
  return [...byKey.values()].sort((a, b) => a.localeCompare(b, "es"));
}

const DAY_MS = 86_400_000;

export interface OfferSuggestion {
  product: Product;
  /** Días sin venta (o desde el alta si nunca se ha vendido). */
  idleDays: number;
  discountPct: number;
  offerPrice: number;
}

/** Fecha de la última venta de cada producto (ventas con ingreso). */
function lastSaleTimes(sales: readonly Sale[]): Map<string, number> {
  const last = new Map<string, number>();
  for (const sale of sales) {
    if (sale.deleted || sale.payment === "interno") continue;
    const time = Date.parse(sale.created_at);
    if (!Number.isFinite(time)) continue;
    for (const item of sale.items ?? []) {
      if ((last.get(item.productId) ?? 0) < time) last.set(item.productId, time);
    }
  }
  return last;
}

/**
 * Ofertas que arroja el sistema: productos con existencia que llevan 30 días o
 * más sin venderse. Descuento 10 % (30–59 días), 15 % (60–89) o 20 % (90+),
 * redondeado a 50 centavos y nunca por debajo de costo + 5 %.
 */
export function suggestOffers(
  products: readonly Product[],
  sales: readonly Sale[],
  stockOf: (productId: string) => number,
  now = Date.now(),
  limit = 12
): OfferSuggestion[] {
  const last = lastSaleTimes(sales);
  const offers: OfferSuggestion[] = [];
  for (const product of products) {
    if (product.active === false || product.deleted || product.price <= 0) continue;
    if (stockOf(product.id) <= 0) continue;
    const created = Date.parse(product.created_at || product.updated_at || "");
    const since = last.get(product.id) ?? (Number.isFinite(created) ? created : now);
    const idleDays = Math.floor((now - since) / DAY_MS);
    if (idleDays < 30) continue;
    const discountPct = idleDays >= 90 ? 20 : idleDays >= 60 ? 15 : 10;
    const floorCents = Math.ceil(toCents(product.cost) * 1.05);
    const rawCents = Math.round(toCents(product.price) * (1 - discountPct / 100));
    const offerCents = Math.max(floorCents, Math.round(rawCents / 50) * 50);
    if (offerCents >= toCents(product.price)) continue; // sin margen para descontar
    offers.push({ product, idleDays, discountPct: Math.round((1 - offerCents / toCents(product.price)) * 100), offerPrice: toPesos(offerCents) });
  }
  return offers.sort((a, b) => b.idleDays - a.idleDays || a.product.name.localeCompare(b.product.name)).slice(0, limit);
}

/** Productos por agotarse (existencia ≤ mínimo), los más urgentes primero. */
export function lowStockProducts(
  products: readonly Product[],
  stockOf: (productId: string) => number,
  minOf: (productId: string) => number,
  limit = 12
): Array<{ product: Product; stock: number; min: number }> {
  return products
    .filter((product) => product.active !== false && !product.deleted)
    .map((product) => ({ product, stock: stockOf(product.id), min: minOf(product.id) }))
    .filter((row) => row.min > 0 ? row.stock <= row.min : row.stock <= 0)
    .sort((a, b) => a.stock - b.stock || a.product.name.localeCompare(b.product.name))
    .slice(0, limit);
}

/** Más vendidos (por cantidad) en los últimos `days` días. */
export function topSellers(
  products: readonly Product[],
  sales: readonly Sale[],
  now = Date.now(),
  days = 30,
  limit = 12
): Array<{ product: Product; qty: number }> {
  const since = now - days * DAY_MS;
  const qty = new Map<string, number>();
  for (const sale of sales) {
    if (sale.deleted || sale.payment === "interno" || Date.parse(sale.created_at) < since) continue;
    for (const item of sale.items ?? []) qty.set(item.productId, (qty.get(item.productId) ?? 0) + Number(item.qty || 0) * (item.pack_size || 1));
  }
  const byId = new Map(products.filter((p) => p.active !== false && !p.deleted).map((p) => [p.id, p]));
  return [...qty.entries()]
    .filter(([id]) => byId.has(id))
    .map(([id, total]) => ({ product: byId.get(id)!, qty: total }))
    .sort((a, b) => b.qty - a.qty || a.product.name.localeCompare(b.product.name))
    .slice(0, limit);
}
