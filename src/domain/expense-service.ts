import { nowISO } from "../core/dates";
import { uid } from "../core/id";
import { sumCents, toCents, toPesos, type Cents } from "../core/money";
import type { Expense } from "../core/types";
import type { Repositories } from "../data/repositories";
import { VIEW_ALL } from "./app-state";
import type { BranchService } from "./branch-service";
import type { SimpleResult } from "./sale-service";

export function isFixedCost(expense: Pick<Expense, "kind">): boolean {
  return expense.kind === "fijo";
}

function monthStart(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

export function daysInMonth(d: Date): number {
  return new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
}

/**
 * Parte de los costos fijos mensuales que corresponde al rango [start, end).
 * Cada costo aplica desde el mes en que se registró y se reparte por la
 * fracción del mes cubierta (un día = monto / días del mes).
 */
export function fixedCostsForRange(expenses: readonly Expense[], start: string, end: string): Cents {
  const rangeStart = Date.parse(start);
  const rangeEnd = Date.parse(end);
  if (!Number.isFinite(rangeStart) || !Number.isFinite(rangeEnd) || rangeEnd <= rangeStart) return 0;
  let total = 0;
  for (const expense of expenses) {
    if (!isFixedCost(expense) || expense.deleted) continue;
    const monthly = toCents(expense.amount);
    if (monthly <= 0) continue;
    const created = new Date(expense.created_at || expense.updated_at || start);
    const applies = Number.isNaN(created.getTime()) ? new Date(rangeStart) : monthStart(created);
    let cursor = monthStart(new Date(Math.max(rangeStart, applies.getTime())));
    while (cursor.getTime() < rangeEnd) {
      const next = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1);
      const from = Math.max(rangeStart, cursor.getTime(), applies.getTime());
      const to = Math.min(rangeEnd, next.getTime());
      if (to > from) total += (monthly * (to - from)) / (next.getTime() - cursor.getTime());
      cursor = next;
    }
  }
  return Math.round(total);
}

/** Monto diario necesario para cubrir un total mensual en el mes de `date`. */
export function dailyTargetCents(monthlyCents: Cents, date = new Date()): Cents {
  return Math.round(monthlyCents / daysInMonth(date));
}

/**
 * Gastos: costos fijos mensuales (base de la meta diaria) y gastos extra
 * pagados de la caja. Ambos se pueden eliminar.
 */
export class ExpenseService {
  constructor(
    private repos: Repositories,
    private branches: BranchService
  ) {}

  private inScope(expense: Expense, scope: string): boolean {
    return scope === VIEW_ALL || expense.branch_id === scope;
  }

  fixedCosts(scope: string = this.branches.operationalId()): Expense[] {
    return this.repos.expenses
      .list()
      .filter((expense) => isFixedCost(expense) && this.inScope(expense, scope))
      .sort((a, b) => b.amount - a.amount || a.concept.localeCompare(b.concept));
  }

  extras(scope: string = this.branches.operationalId()): Expense[] {
    return this.repos.expenses
      .list()
      .filter((expense) => !isFixedCost(expense) && this.inScope(expense, scope))
      .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at));
  }

  monthlyFixedCents(scope: string = this.branches.operationalId()): Cents {
    return sumCents(this.fixedCosts(scope).map((expense) => toCents(expense.amount)));
  }

  dailyTargetCents(scope: string = this.branches.operationalId(), date = new Date()): Cents {
    return dailyTargetCents(this.monthlyFixedCents(scope), date);
  }

  add(kind: "fijo" | "extra", concept: string, amountPesos: number, category: string): SimpleResult {
    const cleanConcept = concept.trim();
    if (!cleanConcept) return { ok: false, error: "Escribe el concepto" };
    const amount = toPesos(toCents(amountPesos));
    if (!Number.isFinite(amount) || amount <= 0) return { ok: false, error: "Monto inválido" };
    const ts = nowISO();
    this.repos.expenses.upsert({
      id: uid(),
      branch_id: this.branches.operationalId(),
      concept: cleanConcept,
      amount,
      category: category || "Varios",
      kind,
      created_at: ts,
      updated_at: ts
    });
    return { ok: true };
  }

  update(id: string, changes: { concept: string; amount: number; category: string }): SimpleResult {
    const expense = this.repos.expenses.byId(id);
    if (!expense || expense.deleted) return { ok: false, error: "No se encontró el gasto" };
    const amount = toPesos(toCents(changes.amount));
    if (!changes.concept.trim()) return { ok: false, error: "Escribe el concepto" };
    if (!Number.isFinite(amount) || amount <= 0) return { ok: false, error: "Monto inválido" };
    this.repos.expenses.upsert({ ...expense, concept: changes.concept.trim(), amount, category: changes.category, updated_at: nowISO() });
    return { ok: true };
  }

  remove(id: string): SimpleResult {
    const expense = this.repos.expenses.byId(id);
    if (!expense || expense.deleted) return { ok: false, error: "No se encontró el gasto" };
    this.repos.expenses.softDelete(id);
    return { ok: true };
  }
}
