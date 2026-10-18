import { dayRange, nowISO, toInputDateValue, todayStartISO } from "../core/dates";
import { uid } from "../core/id";
import { lineTotalCents, sumCents, toCents, toPesos } from "../core/money";
import type { RefundMethod, SaleGroup, Shift, ShiftSummary } from "../core/types";
import type { Repositories } from "../data/repositories";
import type { BranchService } from "./branch-service";
import { isFixedCost } from "./expense-service";
import { groupTotalsCents, isInternalSale, isRevenueSale, itemGroup } from "./sale-groups";

export interface CloseShiftInput {
  opening_cash: number;
  counted_cash: number;
  withdrawn_cash: number;
  next_opening_cash: number;
  notes: string;
}

export type CloseDayResult = { ok: true; shift: Shift } | { ok: false; error: string };

/** Datos del corte de un día pasado: rango, si ya estaba cerrado y su resumen. */
export interface DayShiftInfo {
  day: string;
  /** Inicio del periodo a cortar (último corte o medianoche del día). */
  start: string;
  /** Fin EXCLUSIVO: medianoche local del día siguiente. */
  end: string;
  alreadyClosed: boolean;
  summary: ShiftSummary;
}

/** ¿El corte tiene algún movimiento? (para no crear cortes vacíos). */
export function summaryHasActivity(summary: ShiftSummary): boolean {
  return [
    summary.ventas,
    summary.efectivo,
    summary.transferencia,
    summary.tarjeta,
    summary.fiado,
    summary.abonos ?? 0,
    summary.interno ?? 0,
    summary.gastos,
    summary.proveedores,
    summary.proveedoresAparte ?? 0,
    summary.mermas,
    summary.devoluciones ?? 0
  ].some((value) => toCents(value) !== 0);
}

export class ShiftService {
  constructor(
    private repos: Repositories,
    private branches: BranchService
  ) {}

  /** Inicio del turno vigente: último corte cerrado de la sucursal o inicio del día. */
  shiftStart(branchId: string): string {
    const last = this.repos.shifts
      .list()
      .filter((shift) => shift.branch_id === branchId)
      .sort((a, b) => Date.parse(b.closed_at || "") - Date.parse(a.closed_at || ""))[0];
    return last?.closed_at || todayStartISO();
  }

  lastShift(branchId: string): Shift | undefined {
    return this.repos.shifts
      .list()
      .filter((shift) => shift.branch_id === branchId)
      .sort((a, b) => Date.parse(b.closed_at || "") - Date.parse(a.closed_at || ""))[0];
  }

  /** Último corte cerrado ANTES de `end` (para cortes de días pasados). */
  lastShiftBefore(branchId: string, end: string): Shift | undefined {
    return this.repos.shifts
      .list()
      .filter((shift) => shift.branch_id === branchId && (shift.closed_at || "") < end)
      .sort((a, b) => Date.parse(b.closed_at || "") - Date.parse(a.closed_at || ""))[0];
  }

  history(branchId: string, limit = 20): Shift[] {
    return this.repos.shifts
      .list()
      .filter((shift) => shift.branch_id === branchId)
      .sort((a, b) => Date.parse(b.closed_at || "") - Date.parse(a.closed_at || ""))
      .slice(0, limit);
  }

  summarize(branchId: string): ShiftSummary {
    return this.summarizeRange(branchId, this.shiftStart(branchId), nowISO());
  }

  /** Resumen del periodo (start, end]: sirve para el turno vigente y para días pasados. */
  summarizeRange(branchId: string, start: string, end: string): ShiftSummary {
    const since = (createdAt: string): boolean => createdAt > start && createdAt <= end;
    const branchSales = this.repos.sales.list().filter((s) => s.branch_id === branchId && since(s.created_at));
    const sales = branchSales.filter(isRevenueSale);
    const internal = branchSales.filter(isInternalSale);
    // Solo los gastos extra salen de la caja; los costos fijos mensuales no.
    const expenses = this.repos.expenses
      .list()
      .filter((e) => e.branch_id === branchId && !isFixedCost(e) && since(e.created_at));
    const purchases = this.repos.purchases.list().filter((p) => p.branch_id === branchId && since(p.created_at));
    const mermas = this.repos.mermas.list().filter((m) => m.branch_id === branchId && since(m.created_at));
    // Devoluciones del turno: bajan las ventas (por forma de pago y por grupo),
    // el efectivo esperado (si se reembolsaron en efectivo) y la ganancia por su
    // margen (venta - costo).
    const returns = this.repos.returns.list().filter((ret) => ret.branch_id === branchId && since(ret.created_at));
    const totalCents = (rows: Array<{ total: number }>): number => sumCents(rows.map((row) => toCents(row.total)));
    const gastos = sumCents(expenses.map((expense) => toCents(expense.amount)));
    // Solo las compras pagadas con dinero de la caja salen del efectivo.
    const proveedores = totalCents(purchases.filter((p) => p.paid_from !== "aparte"));
    const proveedoresAparte = totalCents(purchases.filter((p) => p.paid_from === "aparte"));
    const mermasCents = sumCents(mermas.map((merma) => toCents(merma.cost_impact)));
    const devolucionesCents = totalCents(returns);
    const devolucionesPorVia = (method: RefundMethod): number => totalCents(returns.filter((ret) => ret.payment === method));
    const devolucionesEfectivoCents = devolucionesPorVia("efectivo");
    const margenDevueltoCents = sumCents(returns.map((ret) => toCents(ret.total) - toCents(ret.cost)));
    // Ventas netas: a cada forma de pago se le resta lo reembolsado por esa vía.
    const ventas = totalCents(sales) - devolucionesCents;
    const efectivo = totalCents(sales.filter((s) => s.payment === "efectivo")) - devolucionesEfectivoCents;
    // Cobranza de fiado del turno: es efectivo que se recibió y se guardó en
    // la caja, igual que una venta en efectivo. Sin esto el corte marcaba
    // sobrante falso cada vez que un cliente pagaba su deuda.
    let abonosCents = 0;
    this.repos.customers.list().forEach((customer) => {
      if (customer.branch_id && customer.branch_id !== branchId) return;
      (customer.movements ?? []).forEach((movement) => {
        if (movement.type === "pago" && since(movement.created_at)) abonosCents += toCents(movement.amount);
      });
    });
    const gananciaCents = sumCents(sales.map((s) => toCents(s.profit))) - gastos - margenDevueltoCents;
    const groups = groupTotalsCents(sales, (id) => this.repos.products.byId(id));
    // Cigarros y cerveza también van netos de lo devuelto.
    const returnedGroups: Record<SaleGroup, number> = { general: 0, cigarros: 0, cerveza: 0 };
    for (const ret of returns) {
      for (const item of ret.items ?? []) {
        returnedGroups[itemGroup(item, (id) => this.repos.products.byId(id))] += lineTotalCents(item.qty, item.price);
      }
    }
    return {
      ventas: toPesos(ventas),
      efectivo: toPesos(efectivo),
      transferencia: toPesos(totalCents(sales.filter((s) => s.payment === "transferencia")) - devolucionesPorVia("transferencia")),
      tarjeta: toPesos(totalCents(sales.filter((s) => s.payment === "tarjeta")) - devolucionesPorVia("tarjeta")),
      fiado: toPesos(totalCents(sales.filter((s) => s.payment === "fiado")) - devolucionesPorVia("fiado")),
      abonos: toPesos(abonosCents),
      cigarros: toPesos(groups.cigarros - returnedGroups.cigarros),
      cerveza: toPesos(groups.cerveza - returnedGroups.cerveza),
      interno: toPesos(sumCents(internal.map((s) => toCents(s.cost)))),
      devoluciones: toPesos(devolucionesCents),
      devolucionesEfectivo: toPesos(devolucionesEfectivoCents),
      gastos: toPesos(gastos),
      proveedores: toPesos(proveedores),
      proveedoresAparte: toPesos(proveedoresAparte),
      mermas: toPesos(mermasCents),
      ganancia: toPesos(gananciaCents),
      // El efectivo ya viene neto de lo reembolsado en efectivo.
      efectivoEsperado: toPesos(efectivo + abonosCents - gastos - proveedores)
    };
  }

  /** Datos del corte de un día pasado: rango (último corte o la medianoche), si ya
   * estaba cerrado y el resumen del día. */
  dayInfo(branchId: string, day: string): DayShiftInfo {
    const { start: dayStart, end: dayEnd } = dayRange(day);
    const shifts = this.repos.shifts.list().filter((shift) => shift.branch_id === branchId);
    const closedAt = (shift: Shift): string => shift.closed_at || "";
    // Un corte pertenece al día si se cerró después de su medianoche y hasta su
    // medianoche siguiente (los automáticos cierran exactamente en el límite).
    const alreadyClosed = shifts.some((shift) => closedAt(shift) > dayStart && closedAt(shift) <= dayEnd);
    const previous = this.lastShiftBefore(branchId, dayEnd);
    const start = previous && closedAt(previous) > dayStart ? closedAt(previous) : dayStart;
    return { day, start, end: dayEnd, alreadyClosed, summary: this.summarizeRange(branchId, start, dayEnd) };
  }

  /**
   * Cierra el corte de un día pasado (por si se le pasó hacerlo): las ventas
   * de hoy quedan intactas y el corte siguiente arranca desde ese día.
   */
  closeDay(day: string, input: CloseShiftInput): CloseDayResult {
    const branchId = this.branches.operationalId();
    const info = this.dayInfo(branchId, day);
    if (info.alreadyClosed || info.start >= info.end) return { ok: false, error: "Ese día ya tiene un corte" };
    if (!summaryHasActivity(info.summary)) return { ok: false, error: "Ese día no tuvo movimientos" };
    return { ok: true, shift: this.commitShift(branchId, info.summary, input, info.end) };
  }

  /**
   * Cierre automático de medianoche: si el día de ayer quedó sin cerrar y tuvo
   * movimientos, se cierra solo con el efectivo esperado (diferencia $0) para
   * que el día siguiente arranque limpio. Se apaga por sucursal con
   * `auto_close = false`. Idempotente: si ya hay corte de ayer, no hace nada.
   */
  autoCloseIfNeeded(branchId: string): Shift | null {
    const branch = this.branches.byId(branchId);
    if (branch?.auto_close === false) return null;
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const info = this.dayInfo(branchId, toInputDateValue(yesterday));
    if (info.alreadyClosed || info.start >= info.end) return null;
    if (!summaryHasActivity(info.summary)) return null;
    const base = this.lastShiftBefore(branchId, info.end)?.next_opening_cash ?? 0;
    const expected = toPesos(toCents(base) + toCents(info.summary.efectivoEsperado));
    return this.commitShift(
      branchId,
      info.summary,
      {
        opening_cash: base,
        counted_cash: expected,
        withdrawn_cash: 0,
        next_opening_cash: base,
        notes: "Corte automático de medianoche (no se hizo manualmente)"
      },
      info.end,
      // Id determinista: si dos equipos cierran el mismo día a la vez, el sync
      // los fusiona en un solo corte en vez de duplicarlo.
      `auto-${branchId}-${info.day}`
    );
  }

  closeShift(input: CloseShiftInput): Shift {
    const branchId = this.branches.operationalId();
    return this.commitShift(branchId, this.summarize(branchId), input, nowISO());
  }

  private commitShift(branchId: string, summary: ShiftSummary, input: CloseShiftInput, closedAt: string, id = uid()): Shift {
    const expectedWithBase = toPesos(toCents(input.opening_cash) + toCents(summary.efectivoEsperado));
    const expectedDistribution = toPesos(toCents(input.withdrawn_cash) + toCents(input.next_opening_cash));
    const ts = nowISO();
    const shift: Shift = {
      id,
      branch_id: branchId,
      summary,
      opening_cash: input.opening_cash,
      counted_cash: input.counted_cash,
      withdrawn_cash: input.withdrawn_cash,
      next_opening_cash: input.next_opening_cash,
      expected_cash_with_base: expectedWithBase,
      difference: toPesos(toCents(input.counted_cash) - toCents(expectedWithBase)),
      distribution_difference: toPesos(toCents(input.counted_cash) - toCents(expectedDistribution)),
      notes: input.notes,
      closed_at: closedAt,
      updated_at: ts
    };
    this.repos.shifts.upsert(shift);
    return shift;
  }
}
