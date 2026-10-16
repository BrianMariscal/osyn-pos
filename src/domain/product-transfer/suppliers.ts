import type { Product, Supplier } from "../../core/types";
import { nextSupplierNumber, plainText } from "../catalog";
import { headerKey, num } from "./columns";

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
