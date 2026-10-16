import type { SyncTableKey } from "./sync";

export type TabId =
  | "inicio"
  | "venta"
  | "entradas"
  | "productos"
  | "inventario"
  | "mermas"
  | "fiado"
  | "gastos"
  | "proveedores"
  | "corte"
  | "reportes"
  | "ajustes";

export const ALL_TABS: readonly TabId[] = [
  "inicio",
  "venta",
  "entradas",
  "productos",
  "inventario",
  "mermas",
  "fiado",
  "gastos",
  "proveedores",
  "corte",
  "reportes",
  "ajustes"
];

export const TAB_LABELS: Record<TabId, string> = {
  inicio: "Inicio",
  venta: "Venta",
  entradas: "Entradas",
  productos: "Productos",
  inventario: "Inventario",
  mermas: "Mermas",
  fiado: "Fiado",
  gastos: "Gastos",
  proveedores: "Proveedores",
  corte: "Corte",
  reportes: "Reportes",
  ajustes: "Ajustes"
};

export const VENDOR_CONFIGURABLE_TABS: readonly TabId[] = [
  "inicio",
  "venta",
  "entradas",
  "inventario",
  "mermas",
  "fiado",
  "gastos",
  "proveedores",
  "corte",
  "reportes"
];

/** Pestañas del vendedor: en ESTE orden fijo (entradas se muestra como "Recibir mercancía"). */
export const DEFAULT_VENDOR_TABS: readonly TabId[] = ["inicio", "venta", "fiado", "corte", "mermas", "entradas"];

/** Pestañas del administrador (el dueño las elige desde Ajustes; el dueño siempre ve todas). */
export const DEFAULT_ADMIN_TABS: readonly TabId[] = [...ALL_TABS];

/** Tablas que consume cada pestaña (para limitar la sync de un empleado). */
export const TAB_TABLES: Record<TabId, readonly SyncTableKey[]> = {
  inicio: ["products", "product_stocks", "customers", "sales", "returns", "expenses", "purchases", "shifts"],
  venta: ["products", "product_stocks", "customers", "sales", "returns", "suppliers"],
  entradas: ["products", "product_stocks", "purchases", "suppliers"],
  productos: ["products", "product_stocks", "suppliers"],
  inventario: ["products", "product_stocks", "inventory_counts"],
  mermas: ["products", "product_stocks", "mermas"],
  fiado: ["customers", "sales"],
  gastos: ["expenses"],
  proveedores: ["products", "product_stocks", "purchases", "suppliers"],
  corte: ["sales", "returns", "expenses", "purchases", "mermas", "shifts"],
  reportes: [
    "products",
    "product_stocks",
    "customers",
    "sales",
    "returns",
    "expenses",
    "purchases",
    "shifts",
    "month_closings",
    "inventory_counts"
  ],
  ajustes: []
};
