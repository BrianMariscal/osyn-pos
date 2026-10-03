import type {
  Branch,
  CartLine,
  Customer,
  Expense,
  InventoryCount,
  Merma,
  MonthClosing,
  Product,
  ProductStock,
  Purchase,
  Sale,
  Settings,
  Shift,
  Supplier,
  SyncState
} from "../core/types";
import { DEFAULT_ADMIN_TABS, DEFAULT_VENDOR_TABS } from "../core/types";

/** Alcance de vista: id de sucursal o "all" (consolidado, solo admin). */
export const VIEW_ALL = "all";

export interface AppState {
  settings: Settings;
  branches: Branch[];
  suppliers: Supplier[];
  products: Product[];
  product_stocks: ProductStock[];
  customers: Customer[];
  sales: Sale[];
  expenses: Expense[];
  purchases: Purchase[];
  mermas: Merma[];
  shifts: Shift[];
  month_closings: MonthClosing[];
  inventory_counts: InventoryCount[];
  cart: CartLine[];
  /** Sucursal operativa concreta (donde se vende / corta caja). */
  currentBranchId: string;
  /** Alcance de dashboard/reportes para admin: id de sucursal o "all". */
  viewBranchId: string;
  sync: SyncState;
}

export function createInitialState(settingsOverride?: Partial<Settings>): AppState {
  const settings: Settings = {
    storeName: "Mi tienda",
    logo: "",
    whatsappNumber: "",
    vendorTabs: [...DEFAULT_VENDOR_TABS],
    adminTabs: [...DEFAULT_ADMIN_TABS],
    assistantVoiceEnabled: false,
    theme: "auto",
    updated_at: "",
    ...settingsOverride
  };
  return {
    settings,
    branches: [],
    suppliers: [],
    products: [],
    product_stocks: [],
    customers: [],
    sales: [],
    expenses: [],
    purchases: [],
    mermas: [],
    shifts: [],
    month_closings: [],
    inventory_counts: [],
    cart: [],
    currentBranchId: "",
    viewBranchId: VIEW_ALL,
    sync: { lastPulledAt: {}, syncCursors: {}, lastSyncAt: null, error: null, pending: 0, syncing: false }
  };
}

export type StateTableKey = Exclude<keyof AppState, "settings" | "cart" | "currentBranchId" | "viewBranchId" | "sync">;
