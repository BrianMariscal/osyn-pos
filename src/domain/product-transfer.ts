/**
 * Exportar / importar el catálogo completo (Excel o CSV) para migrar datos:
 * todos los campos del producto, su proveedor, categoría, grupo del corte y la
 * existencia/mínimo de la sucursal. Importar reconoce columnas por su
 * encabezado (en cualquier orden) y también las plantillas anteriores.
 */
import { normalizeQty } from "../core/qty";
import { SALE_GROUP_LABELS, SALE_GROUPS, UNITS, type Product, type ProductStock, type SaleGroup, type Supplier, type Unit } from "../core/types";
import { nextSupplierNumber, plainText } from "./catalog";

export const PRODUCT_COLUMNS = [
  "id",
  "nombre",
  "categoria",
  "um",
  "costo",
  "precio",
  "codigo_barras",
  "piezas_caja",
  "precio_caja",
  "proveedor_numero",
  "proveedor",
  "proveedor_giro",
  "proveedor_telefono",
  "grupo_corte",
  "activo",
  "sucursal",
  "existencia",
  "minimo",
  "valor_costo",
  "valor_venta",
  "creado",
  "actualizado"
] as const;

type Field =
  | "id" | "name" | "category" | "um" | "cost" | "price" | "barcode" | "pack" | "packPrice" | "supplierNumber"
  | "supplier" | "supplierType" | "supplierPhone" | "group" | "active" | "stock" | "min";

const ALIASES: Record<Field, string[]> = {
  id: ["id", "id_producto"],
  name: ["nombre", "producto", "name", "descripcion"],
  category: ["categoria", "category"],
  um: ["um", "unidad", "unidad_medida", "unit"],
  cost: ["costo", "cost", "precio_compra"],
  price: ["precio", "precio_venta", "price"],
  barcode: ["codigo_barras", "codigo", "codigo_de_barras", "barcode"],
  pack: ["piezas_caja", "piezas_por_caja", "pack_size"],
  packPrice: ["precio_caja", "precio_por_caja", "pack_price"],
  supplierNumber: ["proveedor_numero", "numero_proveedor", "no_proveedor"],
  supplier: ["proveedor", "supplier"],
  supplierType: ["proveedor_giro", "giro"],
  supplierPhone: ["proveedor_telefono"],
  group: ["grupo_corte", "grupo"],
  active: ["activo", "active"],
  stock: ["existencia", "stock"],
  min: ["minimo", "min_stock", "existencia_minima"]
};

function headerKey(value: string): string {
  return plainText(value).replace(/[\s-]+/g, "_").replace(/[^a-z0-9_]/g, "");
}

function num(value: string | undefined): number {
  const n = Number(String(value ?? "").replace(/[$\s,]/g, ""));
  return Number.isFinite(n) ? n : 0;
}

function parseUnit(value: string | undefined): Unit | undefined {
  const v = plainText(value ?? "");
  if (!v) return undefined;
  const direct = UNITS.find((unit) => unit.toLowerCase() === v);
  if (direct) return direct;
  if (["pieza", "piezas", "pz", "pzas", "pza."].includes(v)) return "Pza";
  if (["kilo", "kilos", "kilogramo", "kilogramos"].includes(v)) return "Kg";
  if (["g", "gramo", "gramos"].includes(v)) return "Gr";
  if (["l", "lt", "litro", "litros"].includes(v)) return "Lts";
  return undefined;
}

function parseGroup(value: string | undefined): SaleGroup | undefined {
  const v = plainText(value ?? "");
  return SALE_GROUPS.find((group) => group === v || plainText(SALE_GROUP_LABELS[group]) === v);
}

function parseActive(value: string | undefined): boolean {
  return !["no", "0", "false", "inactivo", "falso"].includes(plainText(value ?? ""));
}

export interface ExportContext {
  suppliers: ReadonlyMap<string, Supplier>;
  stockOf: (productId: string) => { stock: number; min_stock: number } | undefined;
  branchName: string;
}

/** Filas (con encabezado) de todos los productos con todos sus datos. */
export function productExportRows(products: readonly Product[], ctx: ExportContext): Array<Array<string | number>> {
  const rows = [...products]
    .sort((a, b) => a.name.localeCompare(b.name, "es"))
    .map((product) => {
      const supplier = product.supplier_id ? ctx.suppliers.get(product.supplier_id) : undefined;
      const stock = ctx.stockOf(product.id);
      const qty = normalizeQty(stock?.stock ?? 0);
      return [
        product.id,
        product.name,
        product.category ?? "",
        product.um,
        Number(product.cost ?? 0),
        Number(product.price ?? 0),
        product.barcode ?? "",
        product.pack_size ? Number(product.pack_size) : "",
        product.pack_price ? Number(product.pack_price) : "",
        supplier?.number ? Number(supplier.number) : "",
        supplier?.name ?? "",
        supplier?.type ?? "",
        supplier?.phone ?? "",
        product.sale_group ?? "",
        product.active === false ? "no" : "si",
        ctx.branchName,
        qty,
        normalizeQty(stock?.min_stock ?? 0),
        Math.round(qty * Number(product.cost ?? 0) * 100) / 100,
        Math.round(qty * Number(product.price ?? 0) * 100) / 100,
        product.created_at ?? "",
        product.updated_at ?? ""
      ];
    });
  return [[...PRODUCT_COLUMNS], ...rows];
}

export interface ImportInput {
  rows: string[][];
  products: readonly Product[];
  suppliers: readonly Supplier[];
  stocks: readonly ProductStock[];
  branchId: string;
  now: string;
  newId: () => string;
}

export interface ImportPlan {
  products: Product[];
  suppliers: Supplier[];
  stocks: ProductStock[];
  created: number;
  updated: number;
  skipped: number;
}

/** Columnas por encabezado; null si el archivo no trae encabezado reconocible. */
function mapHeader(header: string[]): Partial<Record<Field, number>> | null {
  const keys = header.map(headerKey);
  const map: Partial<Record<Field, number>> = {};
  for (const [field, aliases] of Object.entries(ALIASES) as Array<[Field, string[]]>) {
    const index = aliases.map((alias) => keys.indexOf(alias)).find((i) => i >= 0);
    if (index !== undefined) map[field] = index;
  }
  return map.name === undefined ? null : map;
}

/** Plantilla anterior sin encabezado reconocible: nombre, categoria, [um], costo, precio, existencia, minimo, codigo, piezas_caja. */
function legacyMap(row: string[]): Partial<Record<Field, number>> {
  const hasUnit = Boolean(parseUnit(row[2]));
  const o = hasUnit ? 1 : 0;
  return { name: 0, category: 1, ...(hasUnit ? { um: 2 } : {}), cost: 2 + o, price: 3 + o, stock: 4 + o, min: 5 + o, barcode: 6 + o, pack: 7 + o };
}

/** Calcula qué crear/actualizar sin tocar el estado (la UI lo guarda). */
export function planProductImport(input: ImportInput): ImportPlan {
  const [header = [], ...body] = input.rows;
  const headerMap = mapHeader(header);
  const dataRows = headerMap ? body : input.rows.slice(1);

  const products = new Map(input.products.filter((p) => !p.deleted).map((p) => [p.id, p]));
  const allSuppliers: Supplier[] = input.suppliers.filter((s) => !s.deleted);
  const newSuppliers: Supplier[] = [];
  const plan: ImportPlan = { products: [], suppliers: newSuppliers, stocks: [], created: 0, updated: 0, skipped: 0 };
  const touched = new Map<string, Product>();

  const findSupplier = (numberText: string, name: string, type: string, phone: string): Supplier | undefined => {
    const number = Math.round(num(numberText));
    const plainName = plainText(name);
    const byName = plainName ? allSuppliers.find((s) => plainText(s.name) === plainName) : undefined;
    const byNumber = number > 0 ? allSuppliers.find((s) => Number(s.number) === number) : undefined;
    // El número solo cuenta si coincide con el nombre (o no hay nombre)
    const found = byName ?? (byNumber && (!plainName || plainText(byNumber.name) === plainName) ? byNumber : undefined);
    if (found || !plainName) return found;
    const created: Supplier = {
      id: input.newId(),
      number: nextSupplierNumber([...input.suppliers, ...newSuppliers]),
      name: name.trim(),
      type: type.trim() || undefined,
      phone: phone.trim(),
      notes: "",
      created_at: input.now,
      updated_at: input.now
    };
    allSuppliers.push(created);
    newSuppliers.push(created);
    return created;
  };

  for (const row of dataRows) {
    const map = headerMap ?? legacyMap(row);
    const has = (field: Field): boolean => map[field] !== undefined;
    const get = (field: Field): string => (map[field] === undefined ? "" : String(row[map[field]!] ?? "").trim());
    const name = get("name");
    if (!name) {
      if (row.some((cell) => String(cell ?? "").trim())) plan.skipped += 1;
      continue;
    }
    const barcode = get("barcode");
    const all = [...products.values(), ...touched.values()];
    const existing =
      (get("id") && (touched.get(get("id")) ?? products.get(get("id")))) ||
      (barcode ? all.find((p) => p.barcode?.trim() === barcode) : undefined) ||
      all.find((p) => plainText(p.name) === plainText(name));

    const product: Product = {
      ...existing,
      id: existing?.id ?? (get("id") || input.newId()),
      name,
      category: get("category") || existing?.category || (has("category") ? "" : "Abarrotes"),
      um: parseUnit(get("um")) ?? existing?.um ?? "Pza",
      cost: has("cost") && get("cost") ? Math.max(0, num(get("cost"))) : existing?.cost ?? 0,
      price: has("price") && get("price") ? Math.max(0, num(get("price"))) : existing?.price ?? 0,
      active: has("active") ? parseActive(get("active")) : true,
      created_at: existing?.created_at ?? input.now,
      updated_at: input.now
    };
    if (barcode) product.barcode = barcode;
    if (has("pack")) {
      const pack = Math.round(normalizeQty(num(get("pack"))));
      product.pack_size = pack > 1 ? pack : undefined;
    }
    if (has("packPrice")) {
      const packPrice = Math.round(Math.max(0, num(get("packPrice"))) * 100) / 100;
      product.pack_price = packPrice > 0 && (product.pack_size ?? 0) > 1 ? packPrice : undefined;
    }
    if (has("group")) product.sale_group = parseGroup(get("group"));
    if (has("supplier") || has("supplierNumber")) {
      product.supplier_id = findSupplier(get("supplierNumber"), get("supplier"), get("supplierType"), get("supplierPhone"))?.id;
    }

    touched.set(product.id, product);
    if (existing) plan.updated += 1;
    else plan.created += 1;

    const stockId = `${product.id}:${input.branchId}`;
    const current = plan.stocks.find((s) => s.id === stockId) ?? input.stocks.find((s) => s.id === stockId && !s.deleted);
    const stockGiven = has("stock") && get("stock") !== "";
    const minGiven = has("min") && get("min") !== "";
    if (stockGiven || minGiven || !current) {
      const next: ProductStock = {
        id: stockId,
        product_id: product.id,
        branch_id: input.branchId,
        stock: stockGiven ? normalizeQty(num(get("stock"))) : normalizeQty(current?.stock ?? 0),
        min_stock: minGiven ? normalizeQty(num(get("min"))) : normalizeQty(current?.min_stock ?? 0),
        updated_at: input.now
      };
      plan.stocks = [...plan.stocks.filter((s) => s.id !== stockId), next];
    }
  }
  plan.products = [...touched.values()];
  return plan;
}

/** Ejemplos para la plantilla cuando aún no hay productos. */
export const PRODUCT_TEMPLATE_EXAMPLES: Array<Array<string | number>> = [
  ["", "Coca Cola 600 ml", "Refrescos", "Pza", 13, 18, "7501055300075", 24, 400, 1, "Coca Cola FEMSA", "Refrescos", "", "", "si", "", 12, 4, "", "", "", ""],
  ["", "Azúcar", "Abarrotes", "Kg", 22, 30, "", "", "", "", "", "", "", "", "si", "", 25.5, 5, "", "", "", ""],
  ["", "Marlboro rojo 20", "Cigarros", "Pza", 70, 85, "", 10, 800, "", "", "", "", "cigarros", "si", "", 20, 5, "", "", "", ""]
];

export const SUPPLIER_COLUMNS = ["id", "numero", "nombre", "giro", "telefono", "notas", "productos", "creado", "actualizado"] as const;

/** Filas (con encabezado) de todos los proveedores. */
export function supplierExportRows(suppliers: readonly Supplier[], products: readonly Product[]): Array<Array<string | number>> {
  const count = new Map<string, number>();
  for (const product of products) {
    if (product.supplier_id && !product.deleted) count.set(product.supplier_id, (count.get(product.supplier_id) ?? 0) + 1);
  }
  const rows = [...suppliers]
    .filter((s) => !s.deleted)
    .sort((a, b) => (a.number ?? 0) - (b.number ?? 0) || a.name.localeCompare(b.name, "es"))
    .map((s) => [s.id, s.number ? Number(s.number) : "", s.name, s.type ?? "", s.phone ?? "", s.notes ?? "", count.get(s.id) ?? 0, s.created_at ?? "", s.updated_at ?? ""]);
  return [[...SUPPLIER_COLUMNS], ...rows];
}

/** Crea o actualiza proveedores desde Excel/CSV (por id, luego por nombre). */
export function planSupplierImport(
  rows: string[][],
  suppliers: readonly Supplier[],
  now: string,
  newId: () => string
): { suppliers: Supplier[]; created: number; updated: number } {
  const [header = [], ...body] = rows;
  const keys = header.map(headerKey);
  const col = (...aliases: string[]): number => aliases.map((a) => keys.indexOf(a)).find((i) => i >= 0) ?? -1;
  const c = {
    id: col("id"),
    number: col("numero", "no", "num", "proveedor_numero"),
    name: col("nombre", "proveedor", "name"),
    type: col("giro", "tipo", "proveedor_giro"),
    phone: col("telefono", "tel", "phone", "proveedor_telefono"),
    notes: col("notas", "nota", "notes")
  };
  const out: Supplier[] = [];
  let created = 0;
  let updated = 0;
  if (c.name < 0) return { suppliers: out, created, updated };
  const live = suppliers.filter((s) => !s.deleted);
  const cell = (row: string[], index: number): string => (index < 0 ? "" : String(row[index] ?? "").trim());
  for (const row of body) {
    const name = cell(row, c.name);
    if (!name) continue;
    const pool = [...live, ...out];
    const existing =
      (cell(row, c.id) && pool.find((s) => s.id === cell(row, c.id))) || pool.find((s) => plainText(s.name) === plainText(name));
    const number = Math.round(num(cell(row, c.number)));
    const numberFree = number > 0 && !pool.some((s) => Number(s.number) === number && s.id !== existing?.id);
    const next: Supplier = {
      ...existing,
      id: existing?.id ?? (cell(row, c.id) || newId()),
      number: existing?.number ?? (numberFree ? number : nextSupplierNumber([...suppliers, ...out])),
      name,
      type: c.type >= 0 ? cell(row, c.type) || undefined : existing?.type,
      phone: c.phone >= 0 ? cell(row, c.phone) : existing?.phone ?? "",
      notes: c.notes >= 0 ? cell(row, c.notes) : existing?.notes ?? "",
      created_at: existing?.created_at ?? now,
      updated_at: now
    };
    const at = out.findIndex((s) => s.id === next.id);
    if (at >= 0) out[at] = next;
    else {
      out.push(next);
      if (existing) updated += 1;
      else created += 1;
    }
  }
  return { suppliers: out, created, updated };
}
