import { nowISO } from "../core/dates";
import { uid } from "../core/id";
import { fmtMoney, lineTotalCents, sumCents, toCents, toPesos } from "../core/money";
import { fmtQty, normalizeBulkQty, normalizeQty, roundQty4 } from "../core/qty";
import { isBulkUnit } from "../core/units";
import type { Customer, RefundMethod, Sale, SaleItem, SaleReturn, SaleReturnItem } from "../core/types";
import type { Repositories } from "../data/repositories";
import type { AppState } from "./app-state";
import type { BranchService } from "./branch-service";
import { moveStock } from "./stock-moves";
import type { Store } from "./store";
import { saleFolio } from "./ticket";

export interface ReturnLineInput {
  /** Posición del renglón en la venta original. */
  index: number;
  qty: number;
}

export interface CreateReturnInput {
  saleId: string;
  lines: ReturnLineInput[];
  payment: RefundMethod;
  reason: string;
  note?: string;
  cashier?: string;
}

export type CreateReturnResult =
  | { ok: true; ret: SaleReturn; warning?: string }
  | { ok: false; error: string };

/** Estado de devolución de cada renglón de una venta. */
export interface PendingReturnLine {
  index: number;
  item: SaleItem;
  /** Cantidad ya devuelta (en unidad base del producto). */
  returned: number;
  /** Cantidad que aún se puede devolver. */
  pending: number;
}

/**
 * Devoluciones de mercancía: la venta original no se toca, se registra una
 * devolución con los renglones y cantidades que regresan. El stock vuelve al
 * inventario, el reembolso se descuenta de la caja (o se abona al fiado) y el
 * servidor valida el tope contra la venta original.
 */
export class ReturnService {
  constructor(
    private store: Store<AppState>,
    private repos: Repositories,
    private branches: BranchService
  ) {}

  /** Devoluciones registradas de una venta (sin tombstones). */
  returnsOf(saleId: string): SaleReturn[] {
    return this.repos.returns.list().filter((ret) => ret.sale_id === saleId);
  }

  /** Por renglón de la venta: cuánto se vendió, cuánto se devolvió y cuánto falta. */
  pendingLines(sale: Sale): PendingReturnLine[] {
    const returned = new Map<number, number>();
    for (const ret of this.returnsOf(sale.id)) {
      for (const item of ret.items ?? []) {
        const index = Number(item.index);
        if (!Number.isFinite(index)) continue;
        returned.set(index, roundQty4((returned.get(index) ?? 0) + Number(item.qty ?? 0)));
      }
    }
    return (sale.items ?? []).map((item, index) => {
      const done = returned.get(index) ?? 0;
      return { index, item, returned: done, pending: Math.max(0, roundQty4(item.qty - done)) };
    });
  }

  /** ¿Queda algo por devolver? (para el botón en el ticket). */
  hasPending(sale: Sale): boolean {
    if (sale.payment === "interno") return false;
    return this.pendingLines(sale).some((line) => line.pending > 0);
  }

  /** Total ya devuelto de una venta (informativo). */
  returnedTotal(saleId: string): number {
    return this.returnsOf(saleId).reduce((sum, ret) => sum + (ret.total ?? 0), 0);
  }

  create(input: CreateReturnInput): CreateReturnResult {
    const sale = this.repos.sales.byId(input.saleId);
    if (!sale || sale.deleted) return { ok: false, error: "No se encontró la venta" };
    if (sale.payment === "interno") return { ok: false, error: "Las ventas de uso interno no se pueden devolver" };
    if (input.payment === "fiado" && !sale.customer_id) {
      return { ok: false, error: "Esta venta no es de fiado: elige efectivo, transferencia o tarjeta" };
    }

    const pending = new Map(this.pendingLines(sale).map((line) => [line.index, line]));
    // Un renglón repetido burlaría el tope (el servidor también los rechaza).
    const seenIndexes = new Set<number>();
    for (const line of input.lines) {
      if (seenIndexes.has(line.index)) return { ok: false, error: "Hay un renglón repetido en la devolución" };
      seenIndexes.add(line.index);
    }
    const items: SaleReturnItem[] = [];
    for (const line of input.lines) {
      const target = pending.get(line.index);
      if (!target) return { ok: false, error: "Renglón inválido para esta venta" };
      const qty = isBulkUnit(target.item.um) ? normalizeBulkQty(line.qty) : normalizeQty(line.qty);
      if (qty <= 0) continue;
      if (qty > target.pending + 1e-9) {
        return { ok: false, error: `De ${target.item.name} solo quedan ${fmtQty(target.pending)} ${target.item.um} por devolver` };
      }
      items.push({
        index: target.index,
        productId: target.item.productId,
        name: target.item.name,
        qty,
        price: target.item.price,
        cost: target.item.cost,
        um: target.item.um,
        ...(target.item.pack_size ? { pack_size: target.item.pack_size } : {}),
        ...(target.item.group ? { group: target.item.group } : {})
      });
    }
    if (!items.length) return { ok: false, error: "Elige al menos un producto a devolver" };

    // La devolución de fiado abona al cliente: se revisa ANTES de mover stock.
    let customer: Customer | null = null;
    if (input.payment === "fiado" && sale.customer_id) {
      const found = this.repos.customers.byId(sale.customer_id);
      if (!found || found.deleted) return { ok: false, error: "No se encontró el cliente de fiado" };
      customer = found;
    }

    const totalCents = sumCents(items.map((item) => lineTotalCents(item.qty, item.price)));
    const costCents = sumCents(items.map((item) => lineTotalCents(item.qty, item.cost)));
    const ts = nowISO();
    const branchId = sale.branch_id || this.branches.operationalId();
    const serverStock = Boolean(this.store.getState().sync.serverStock);
    const ret: SaleReturn = {
      id: uid(),
      branch_id: branchId,
      sale_id: sale.id,
      folio: saleFolio(sale),
      items,
      total: toPesos(totalCents),
      cost: toPesos(costCents),
      payment: input.payment,
      customer_id: customer ? customer.id : null,
      reason: input.reason,
      note: input.note?.trim() ?? "",
      ...(input.cashier ? { cashier: input.cashier } : {}),
      ...(serverStock ? { stock_by_server: true } : {}),
      created_at: ts,
      updated_at: ts
    };

    const piecesByProduct = new Map<string, number>();
    for (const item of items) {
      const pieces = roundQty4(item.qty * (item.pack_size || 1));
      piecesByProduct.set(item.productId, roundQty4((piecesByProduct.get(item.productId) ?? 0) + pieces));
    }
    for (const [productId, pieces] of piecesByProduct) {
      moveStock(this.repos, serverStock, productId, branchId, pieces, ts);
    }

    let warning: string | undefined;
    if (customer) {
      const detail = items.map((item) => `${fmtQty(item.qty)} ${item.name}`).join(", ");
      const note = `Devolución (venta ${ret.folio}): ${detail.length > 110 ? `${detail.slice(0, 107)}…` : detail}`;
      const nextBalance = Math.round((customer.balance - ret.total) * 100) / 100;
      this.repos.customers.upsert({
        ...customer,
        balance: Math.max(0, nextBalance),
        movements: [{ id: uid(), type: "devolucion", amount: ret.total, note, sale_id: sale.id, return_id: ret.id, created_at: ts }, ...customer.movements],
        updated_at: ts
      });
      if (nextBalance < 0) {
        warning = `El abono (${fmtMoney(totalCents)}) supera el saldo del cliente: quedan ${fmtMoney(toCents(-nextBalance))} a su favor (entregar el sobrante en efectivo).`;
      }
    }

    this.repos.returns.upsert(ret);
    return { ok: true, ret, ...(warning ? { warning } : {}) };
  }
}
