import { nowISO, todayStartISO } from "../core/dates";
import { uid } from "../core/id";
import { sumCents, toCents, toPesos } from "../core/money";
import type { Shift, ShiftSummary } from "../core/types";
import type { Repositories } from "../data/repositories";
import type { BranchService } from "./branch-service";
import { isFixedCost } from "./expense-service";
import { groupTotalsCents, isInternalSale, isRevenueSale } from "./sale-groups";

export interface CloseShiftInput {
  opening_cash: number;
  counted_cash: number;
  withdrawn_cash: number;
  next_opening_cash: number;
  notes: string;
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

  history(branchId: string, limit = 20): Shift[] {
    return this.repos.shifts
      .list()
      .filter((shift) => shift.branch_id === branchId)
      .sort((a, b) => Date.parse(b.closed_at || "") - Date.parse(a.closed_at || ""))
      .slice(0, limit);
  }

  summarize(branchId: string): ShiftSummary {
    const start = this.shiftStart(branchId);
    const since = (createdAt: string): boolean => createdAt > start;
    const branchSales = this.repos.sales.list().filter((s) => s.branch_id === branchId && since(s.created_at));
    const sales = branchSales.filter(isRevenueSale);
    const internal = branchSales.filter(isInternalSale);
    // Solo los gastos extra salen de la caja; los costos fijos mensuales no.
    const expenses = this.repos.expenses
      .list()
      .filter((e) => e.branch_id === branchId && !isFixedCost(e) && since(e.created_at));
    const purchases = this.repos.purchases.list().filter((p) => p.branch_id === branchId && since(p.created_at));
    const mermas = this.repos.mermas.list().filter((m) => m.branch_id === branchId && since(m.created_at));
    // Devoluciones del turno: bajan el efectivo (si se reembolsaron en efectivo)
    // y bajan la ganancia por su margen (venta - costo).
    const returns = this.repos.returns.list().filter((ret) => ret.branch_id === branchId && since(ret.created_at));
    const totalCents = (rows: Array<{ total: number }>): number => sumCents(rows.map((row) => toCents(row.total)));
    const ventas = totalCents(sales);
    const gastos = sumCents(expenses.map((expense) => toCents(expense.amount)));
    // Solo las compras pagadas con dinero de la caja salen del efectivo.
    const proveedores = totalCents(purchases.filter((p) => p.paid_from !== "aparte"));
    const proveedoresAparte = totalCents(purchases.filter((p) => p.paid_from === "aparte"));
    const mermasCents = sumCents(mermas.map((merma) => toCents(merma.cost_impact)));
    const devolucionesCents = totalCents(returns);
    const devolucionesEfectivoCents = totalCents(returns.filter((ret) => ret.payment === "efectivo"));
    const margenDevueltoCents = sumCents(returns.map((ret) => toCents(ret.total) - toCents(ret.cost)));
    const efectivo = totalCents(sales.filter((s) => s.payment === "efectivo"));
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
    return {
      ventas: toPesos(ventas),
      efectivo: toPesos(efectivo),
      transferencia: toPesos(totalCents(sales.filter((s) => s.payment === "transferencia"))),
      tarjeta: toPesos(totalCents(sales.filter((s) => s.payment === "tarjeta"))),
      fiado: toPesos(totalCents(sales.filter((s) => s.payment === "fiado"))),
      abonos: toPesos(abonosCents),
      cigarros: toPesos(groups.cigarros),
      cerveza: toPesos(groups.cerveza),
      interno: toPesos(sumCents(internal.map((s) => toCents(s.cost)))),
      devoluciones: toPesos(devolucionesCents),
      devolucionesEfectivo: toPesos(devolucionesEfectivoCents),
      gastos: toPesos(gastos),
      proveedores: toPesos(proveedores),
      proveedoresAparte: toPesos(proveedoresAparte),
      mermas: toPesos(mermasCents),
      ganancia: toPesos(gananciaCents),
      efectivoEsperado: toPesos(efectivo + abonosCents - gastos - proveedores - devolucionesEfectivoCents)
    };
  }

  closeShift(input: CloseShiftInput): Shift {
    const branchId = this.branches.operationalId();
    const summary = this.summarize(branchId);
    const expectedWithBase = toPesos(toCents(input.opening_cash) + toCents(summary.efectivoEsperado));
    const expectedDistribution = toPesos(toCents(input.withdrawn_cash) + toCents(input.next_opening_cash));
    const ts = nowISO();
    const shift: Shift = {
      id: uid(),
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
      closed_at: ts,
      updated_at: ts
    };
    this.repos.shifts.upsert(shift);
    return shift;
  }
}
