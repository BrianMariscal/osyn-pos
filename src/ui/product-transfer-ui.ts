/** Botones de exportar/importar catálogo completo (Productos e Inventario). */
import { nowISO } from "../core/dates";
import { uid } from "../core/id";
import {
  PRODUCT_COLUMNS,
  PRODUCT_TEMPLATE_EXAMPLES,
  planProductImport,
  planSupplierImport,
  productExportRows,
  supplierExportRows
} from "../domain/product-transfer";
import type { AppContext } from "./context";
import { readTableFile } from "./tabs/csv";
import { downloadCsv, downloadXls } from "./tabs/download";

function fileStamp(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Descarga todos los productos con todos sus datos; sin productos, una plantilla con ejemplos. */
export function exportProducts(ctx: AppContext, format: "xls" | "csv", baseName = "productos"): void {
  const branchId = ctx.branches.operationalId();
  const products = ctx.repos.products.list();
  const stocks = new Map(ctx.repos.stocks.list().filter((row) => row.branch_id === branchId).map((row) => [row.product_id, row]));
  const rows = products.length
    ? productExportRows(products, {
        suppliers: new Map(ctx.repos.suppliers.list().map((s) => [s.id, s])),
        stockOf: (id) => stocks.get(id),
        branchName: ctx.branches.name(branchId)
      })
    : [[...PRODUCT_COLUMNS], ...PRODUCT_TEMPLATE_EXAMPLES];
  const name = products.length ? `${baseName}-${fileStamp()}` : `plantilla-${baseName}`;
  if (format === "xls") downloadXls(`${name}.xls`, "Productos", rows);
  else downloadCsv(`${name}.csv`, rows);
}

/** Importa un Excel/CSV: crea o actualiza productos, proveedores y existencias de la sucursal actual. */
export async function importProducts(ctx: AppContext, file: File): Promise<void> {
  let rows: string[][];
  try {
    rows = await readTableFile(file);
  } catch (error) {
    ctx.toast(error instanceof Error ? error.message : "No se pudo leer el archivo");
    return;
  }
  const branchId = ctx.branches.operationalId();
  const plan = planProductImport({
    rows,
    products: ctx.repos.products.all(),
    suppliers: ctx.repos.suppliers.all(),
    stocks: ctx.repos.stocks.all(),
    branchId,
    now: nowISO(),
    newId: uid
  });
  if (plan.suppliers.length) ctx.repos.suppliers.upsertMany(plan.suppliers);
  if (plan.products.length) ctx.repos.products.upsertMany(plan.products);
  if (plan.stocks.length) ctx.repos.stocks.upsertMany(plan.stocks);
  const parts = [`${plan.created} nuevos`, `${plan.updated} actualizados`];
  if (plan.suppliers.length) parts.push(`${plan.suppliers.length} proveedores nuevos`);
  if (plan.skipped) parts.push(`${plan.skipped} filas sin nombre omitidas`);
  ctx.toast(`Productos importados a ${ctx.branches.name(branchId)}: ${parts.join(", ")}`);
}

export function exportSuppliers(ctx: AppContext, format: "xls" | "csv"): void {
  const rows = supplierExportRows(ctx.repos.suppliers.list(), ctx.repos.products.list());
  const name = `proveedores-${fileStamp()}`;
  if (format === "xls") downloadXls(`${name}.xls`, "Proveedores", rows);
  else downloadCsv(`${name}.csv`, rows);
}

export async function importSuppliers(ctx: AppContext, file: File): Promise<void> {
  let rows: string[][];
  try {
    rows = await readTableFile(file);
  } catch (error) {
    ctx.toast(error instanceof Error ? error.message : "No se pudo leer el archivo");
    return;
  }
  const plan = planSupplierImport(rows, ctx.repos.suppliers.all(), nowISO(), uid);
  if (!plan.suppliers.length) {
    ctx.toast("No se encontraron proveedores (falta la columna \"nombre\")");
    return;
  }
  ctx.repos.suppliers.upsertMany(plan.suppliers);
  ctx.toast(`Proveedores: ${plan.created} nuevos, ${plan.updated} actualizados`);
}
