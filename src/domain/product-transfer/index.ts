/**
 * Exportar / importar el catálogo completo (Excel o CSV) para migrar datos:
 * todos los campos del producto, su proveedor, categoría, grupo del corte y la
 * existencia/mínimo de la sucursal. Importar reconoce columnas por su
 * encabezado (en cualquier orden) y también las plantillas anteriores.
 */
export { PRODUCT_COLUMNS } from "./columns";
export {
  productExportRows,
  planProductImport,
  PRODUCT_TEMPLATE_EXAMPLES,
  type ExportContext,
  type ImportInput,
  type ImportPlan
} from "./products";
export { SUPPLIER_COLUMNS, supplierExportRows, planSupplierImport } from "./suppliers";
