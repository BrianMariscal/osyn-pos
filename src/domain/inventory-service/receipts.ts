import { uid } from "../../core/id";
import { toCents, toPesos } from "../../core/money";
import { normalizeQty } from "../../core/qty";
import type { Merma, MermaReason, Product, Purchase, PurchasePayment } from "../../core/types";

/** Producto con su costo promedio ponderado tras una entrada de mercancía. */
export function withAverageCost(product: Product, previousStock: number, totalPaid: number, quantity: number, ts: string): Product {
  const averageCost = (previousStock * product.cost + totalPaid) / (previousStock + quantity);
  return { ...product, cost: toPesos(Math.round(toCents(averageCost))), updated_at: ts };
}

export interface PurchaseInput {
  branchId: string;
  supplier: string;
  product: Product;
  qty: number;
  totalPaid: number;
  pack?: { packs?: number; packSize?: number };
  paidFrom: PurchasePayment;
  serverStock: boolean;
  ts: string;
}

/** Registro de compra para reportes (una línea de la entrega). */
export function buildPurchase(input: PurchaseInput): Purchase {
  return {
    id: uid(),
    branch_id: input.branchId,
    supplier: input.supplier.trim() || "Entrada de inventario",
    product_id: input.product.id,
    product_name: input.product.name,
    um: input.product.um,
    qty: input.qty,
    total: Math.round(input.totalPaid * 100) / 100,
    ...(input.pack?.packs && input.pack.packSize ? { packs: normalizeQty(input.pack.packs), pack_size: normalizeQty(input.pack.packSize) } : {}),
    ...(input.paidFrom === "aparte" ? { paid_from: "aparte" as const } : {}),
    ...(input.serverStock ? { stock_by_server: true } : {}),
    created_at: input.ts,
    updated_at: input.ts
  };
}

export interface MermaInput {
  branchId: string;
  product: Product;
  qty: number;
  reason: MermaReason;
  note: string;
  serverStock: boolean;
  ts: string;
}

/** Registro de merma: producto perdido sin venta. */
export function buildMerma(input: MermaInput): Merma {
  return {
    id: uid(),
    branch_id: input.branchId,
    product_id: input.product.id,
    product_name: input.product.name,
    um: input.product.um,
    qty: input.qty,
    reason: input.reason,
    note: input.note,
    cost_impact: toPesos(Math.round(input.qty * toCents(input.product.cost))),
    ...(input.serverStock ? { stock_by_server: true } : {}),
    created_at: input.ts,
    updated_at: input.ts
  };
}
