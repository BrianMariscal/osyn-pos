import type { SaleGroup, Unit } from "./base";

/** Cómo se le reembolsa al cliente una devolución. "fiado" = abono a su cuenta. */
export type RefundMethod = "efectivo" | "transferencia" | "tarjeta" | "fiado";
export const REFUND_METHODS: readonly RefundMethod[] = ["efectivo", "transferencia", "tarjeta", "fiado"];
export const REFUND_LABELS: Record<RefundMethod, string> = {
  efectivo: "Efectivo",
  transferencia: "Transferencia",
  tarjeta: "Tarjeta",
  fiado: "Abono a fiado"
};

export const RETURN_REASONS = ["Se arrepintió", "Producto dañado", "Error de cobro", "Otro"] as const;
export type ReturnReason = (typeof RETURN_REASONS)[number];

export interface SaleReturnItem {
  /** Posición del renglón en la venta original (el servidor topa la cantidad ahí). */
  index: number;
  productId: string;
  name: string;
  qty: number;
  price: number;
  cost: number;
  um: Unit;
  pack_size?: number;
  group?: SaleGroup;
}

/** Devolución de mercancía: regresa stock al inventario y reembolsa al cliente. */
export interface SaleReturn {
  id: string;
  branch_id: string;
  sale_id: string;
  /** Folio de la venta original (AAMMDD-XXXX), para buscarla fácil. */
  folio: string;
  items: SaleReturnItem[];
  /** Importe reembolsado, a precio de venta. */
  total: number;
  /** Costo de lo devuelto (para la ganancia del periodo). */
  cost: number;
  payment: RefundMethod;
  customer_id: string | null;
  reason: string;
  note: string;
  cashier?: string;
  stock_by_server?: boolean;
  created_at: string;
  updated_at: string;
  deleted?: boolean;
}
