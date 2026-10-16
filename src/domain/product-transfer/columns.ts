import { SALE_GROUP_LABELS, SALE_GROUPS, UNITS, type SaleGroup, type Unit } from "../../core/types";
import { plainText } from "../catalog";

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

export type Field =
  | "id" | "name" | "category" | "um" | "cost" | "price" | "barcode" | "pack" | "packPrice" | "supplierNumber"
  | "supplier" | "supplierType" | "supplierPhone" | "group" | "active" | "stock" | "min";

export const ALIASES: Record<Field, string[]> = {
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

export function headerKey(value: string): string {
  return plainText(value).replace(/[\s-]+/g, "_").replace(/[^a-z0-9_]/g, "");
}

export function num(value: string | undefined): number {
  const n = Number(String(value ?? "").replace(/[$\s,]/g, ""));
  return Number.isFinite(n) ? n : 0;
}

export function parseUnit(value: string | undefined): Unit | undefined {
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

export function parseGroup(value: string | undefined): SaleGroup | undefined {
  const v = plainText(value ?? "");
  return SALE_GROUPS.find((group) => group === v || plainText(SALE_GROUP_LABELS[group]) === v);
}

export function parseActive(value: string | undefined): boolean {
  return !["no", "0", "false", "inactivo", "falso"].includes(plainText(value ?? ""));
}
