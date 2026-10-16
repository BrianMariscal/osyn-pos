import type { PaymentMethod, SaleGroup, Unit } from "./base";

/** Unidad de venta de un renglón: pieza suelta o caja completa (pack_size piezas). */
export type CartUnit = "pza" | "caja";

export interface CartLine {
  productId: string;
  qty: number;
  /** Sin valor = pieza. En "caja", qty son cajas. */
  unit?: CartUnit;
  /** Precio de oferta sugerida por el sistema (sustituye al precio normal). */
  promoPrice?: number;
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
  /** Precio normal cuando se vendió en oferta (price = precio de oferta). */
  regular_price?: number;
  /** Renglón vendido por caja: qty son cajas de pack_size piezas y price es el de la caja. */
  pack_size?: number;
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
  /** El servidor descuenta el stock de esta venta (la app ya no lo sube). */
  stock_by_server?: boolean;
  /** Efectivo: con cuánto pagó el cliente y el cambio entregado. */
  cash_received?: number;
  change?: number;
  /** Quién cobró (nombre del usuario). */
  cashier?: string;
  created_at: string;
  updated_at: string;
  deleted?: boolean;
}

export interface CustomerMovement {
  id: string;
  type: "cargo" | "pago" | "devolucion";
  amount: number;
  note: string;
  /** Venta que originó el cargo (ventas fiadas). */
  sale_id?: string;
  /** Devolución que originó el abono. */
  return_id?: string;
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
