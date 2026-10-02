export type Unit = "Pza" | "Kg" | "Gr" | "Lts";
/** "interno": consumo de la tienda (limpieza, mantenimiento): baja inventario pero NO es venta. */
export type PaymentMethod = "efectivo" | "transferencia" | "tarjeta" | "fiado" | "interno";
export const PAYMENT_METHODS: readonly PaymentMethod[] = ["efectivo", "transferencia", "tarjeta", "fiado", "interno"];

/** Grupo de producto que el corte reporta por separado. */
export type SaleGroup = "general" | "cigarros" | "cerveza";
export const SALE_GROUPS: readonly SaleGroup[] = ["general", "cigarros", "cerveza"];
export const SALE_GROUP_LABELS: Record<SaleGroup, string> = {
  general: "General",
  cigarros: "Cigarros",
  cerveza: "Cerveza"
};
export type Role = "dueno" | "admin" | "empleado";
export const ROLE_LABELS: Record<Role, string> = {
  dueno: "Dueño",
  admin: "Administrador",
  empleado: "Vendedor"
};
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

export interface Branch {
  id: string;
  name: string;
  address: string;
  active: boolean;
  created_at?: string;
  updated_at: string;
  deleted?: boolean;
}

export interface Product {
  id: string;
  name: string;
  category: string;
  um: Unit;
  cost: number;
  price: number;
  barcode?: string;
  /** Proveedor que surte el producto (catálogo de proveedores). */
  supplier_id?: string;
  /** Piezas por caja/paquete: las compras capturadas en cajas se convierten a piezas. */
  pack_size?: number;
  /** Grupo para el corte (cigarros/cerveza). Sin valor = se detecta por categoría/nombre. */
  sale_group?: SaleGroup;
  /** Existencia heredada: se migra a product_stocks al primer arranque. */
  stock?: number;
  min_stock?: number;
  active: boolean;
  seed_example?: boolean;
  created_at?: string;
  updated_at: string;
  deleted?: boolean;
}

/** Existencia de un producto en una sucursal. id = `${product_id}:${branch_id}` */
export interface ProductStock {
  id: string;
  product_id: string;
  branch_id: string;
  stock: number;
  min_stock: number;
  updated_at: string;
  deleted?: boolean;
}

export interface CartLine {
  productId: string;
  qty: number;
}

export interface SaleItem {
  productId: string;
  name: string;
  qty: number;
  price: number;
  cost: number;
  um: Unit;
  /** Grupo del producto al momento de la venta (para separar cigarros/cerveza). */
  group?: SaleGroup;
}

export interface Sale {
  id: string;
  branch_id: string;
  items: SaleItem[];
  total: number;
  cost: number;
  profit: number;
  payment: PaymentMethod;
  customer_id: string | null;
  created_at: string;
  updated_at: string;
  deleted?: boolean;
}

export interface CustomerMovement {
  id: string;
  type: "cargo" | "pago";
  amount: number;
  note: string;
  /** Venta que originó el cargo (ventas fiadas). */
  sale_id?: string;
  created_at: string;
}

export interface Customer {
  id: string;
  branch_id: string;
  name: string;
  phone: string;
  /** Datos extra del cliente: dirección, referencias, etc. */
  notes?: string;
  balance: number;
  movements: CustomerMovement[];
  created_at: string;
  updated_at: string;
  deleted?: boolean;
}

/**
 * "fijo": costo fijo MENSUAL (renta, luz, sueldos) que se reparte por día.
 * "extra" (o sin valor, datos anteriores): gasto pagado de la caja en el momento.
 */
export type ExpenseKind = "fijo" | "extra";

export interface Expense {
  id: string;
  branch_id: string;
  concept: string;
  /** Fijo: monto mensual. Extra: monto pagado. */
  amount: number;
  category: string;
  kind?: ExpenseKind;
  created_at: string;
  updated_at: string;
  deleted?: boolean;
}

export interface Purchase {
  id: string;
  branch_id: string;
  supplier: string;
  product_id: string;
  product_name: string;
  um: Unit;
  qty: number;
  total: number;
  /** Cajas capturadas y piezas por caja (si la compra se capturó en cajas). */
  packs?: number;
  pack_size?: number;
  created_at: string;
  updated_at: string;
  deleted?: boolean;
}

/** Catálogo global de proveedores (Central de Abastos, distribuidoras, etc.). */
export interface Supplier {
  id: string;
  /** Número de proveedor consecutivo, asignado automáticamente. */
  number?: number;
  name: string;
  /** Giro: qué tipo de productos surte (refrescos, cerveza, cigarros…). */
  type?: string;
  phone: string;
  notes: string;
  created_at?: string;
  updated_at: string;
  deleted?: boolean;
}

export const MERMA_REASONS = ["Caducado", "Dañado", "Roto", "Vencido", "Otro"] as const;
export type MermaReason = (typeof MERMA_REASONS)[number];

/** Merma: pérdida de producto sin venta (caducado, dañado, roto). */
export interface Merma {
  id: string;
  branch_id: string;
  product_id: string;
  product_name: string;
  um: Unit;
  qty: number;
  reason: MermaReason;
  note: string;
  cost_impact: number;
  created_at: string;
  updated_at: string;
  deleted?: boolean;
}

export interface ShiftSummary {
  ventas: number;
  efectivo: number;
  transferencia: number;
  tarjeta: number;
  fiado: number;
  /** Ventas de cigarros y de cerveza (incluidas en `ventas`). */
  cigarros?: number;
  cerveza?: number;
  /** Consumo interno de la tienda, valuado a costo (NO incluido en `ventas`). */
  interno?: number;
  gastos: number;
  proveedores: number;
  mermas: number;
  ganancia: number;
  efectivoEsperado: number;
}

export interface Shift {
  id: string;
  branch_id: string;
  summary: ShiftSummary;
  opening_cash: number;
  counted_cash: number;
  withdrawn_cash: number;
  next_opening_cash: number;
  expected_cash_with_base: number;
  difference: number;
  distribution_difference: number;
  notes: string;
  closed_at: string;
  updated_at: string;
  deleted?: boolean;
}

export interface ProductSaleStat {
  id: string;
  name: string;
  qty: number;
  total: number;
  um: Unit;
}

export interface PeriodReport {
  start: string;
  end: string;
  branch_id: string | "all";
  sales_total: number;
  sales_cost: number;
  gross_profit: number;
  /** Gastos totales del periodo = costos fijos prorrateados + gastos extra. */
  expenses_total: number;
  fixed_costs_total?: number;
  extra_expenses_total?: number;
  cigarros_total?: number;
  cerveza_total?: number;
  internal_total?: number;
  purchases_total: number;
  mermas_total: number;
  mermas_count: number;
  profit_after_expenses: number;
  credit_total: number;
  sales_count: number;
  expenses_count: number;
  purchases_count: number;
  top_products: ProductSaleStat[];
  slow_products: ProductSaleStat[];
}

export interface MonthClosing {
  id: string;
  branch_id: string;
  month: string;
  report: PeriodReport;
  closed_at: string;
  updated_at: string;
  deleted?: boolean;
}

export interface CountIncidence {
  product_id: string;
  name: string;
  category: string;
  um: Unit;
  system_stock: number;
  physical_stock: number;
  difference: number;
  cost_impact: number;
  sale_impact: number;
}

export interface CountSummary {
  captured: number;
  ok: number;
  shortage: number;
  surplus: number;
  adjusted: number;
  costImpact: number;
  saleImpact: number;
  incidences: CountIncidence[];
}

export interface InventoryCount {
  id: string;
  branch_id: string;
  started_at: string;
  applied_at: string;
  summary: CountSummary;
  incidences: CountIncidence[];
  updated_at: string;
  deleted?: boolean;
}

export type ThemePreference = "auto" | "light" | "dark";

export interface Settings {
  storeName: string;
  logo: string;
  whatsappNumber: string;
  whatsapp2?: string;
  whatsapp3?: string;
  vendorTabs: TabId[];
  /** Pestañas que ve el administrador (definidas por el dueño). Sin valor = todas. */
  adminTabs?: TabId[];
  assistantVoiceEnabled: boolean;
  theme: ThemePreference;
  updated_at: string;
}

export interface AuthUser {
  id: string;
  email?: string;
}

export interface AuthSession {
  access_token: string;
  refresh_token: string;
  expires_at: number;
  user: AuthUser;
  role: Role;
  name: string;
  branch_id: string | null;
}

export type SyncTableKey =
  | "branches"
  | "suppliers"
  | "products"
  | "product_stocks"
  | "customers"
  | "sales"
  | "expenses"
  | "purchases"
  | "mermas"
  | "shifts"
  | "month_closings"
  | "inventory_counts";

export interface SyncState {
  lastPulledAt: Partial<Record<SyncTableKey, string>>;
  lastSyncAt: string | null;
  error: string | null;
  pending: number;
  syncing: boolean;
}

export const SETTINGS_ROW_ID = "__pos_settings__";

/** Sucursal inicial que se crea por defecto; el dueño agrega más cuando quiera. */
export const DEFAULT_BRANCH_ID = "sucursal-1";
export const DEFAULT_BRANCH_NAME = "Sucursal 1";
export const UNITS: readonly Unit[] = ["Pza", "Kg", "Gr", "Lts"];

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
  inicio: ["products", "product_stocks", "customers", "sales", "expenses", "purchases", "shifts"],
  venta: ["products", "product_stocks", "customers", "sales", "suppliers"],
  entradas: ["products", "product_stocks", "purchases", "suppliers"],
  productos: ["products", "product_stocks", "suppliers"],
  inventario: ["products", "product_stocks", "inventory_counts"],
  mermas: ["products", "product_stocks", "mermas"],
  fiado: ["customers", "sales"],
  gastos: ["expenses"],
  proveedores: ["products", "product_stocks", "purchases", "suppliers"],
  corte: ["sales", "expenses", "purchases", "mermas", "shifts"],
  reportes: [
    "products",
    "product_stocks",
    "customers",
    "sales",
    "expenses",
    "purchases",
    "shifts",
    "month_closings",
    "inventory_counts"
  ],
  ajustes: []
};

export const EXPENSE_CATEGORIES = ["Renta", "Luz", "Agua", "Sueldos", "Transporte", "Varios"] as const;
export const PAYMENT_LABELS: Record<PaymentMethod, string> = {
  efectivo: "Efectivo",
  transferencia: "Transferencia",
  tarjeta: "Tarjeta",
  fiado: "Fiado",
  interno: "Venta interna"
};
