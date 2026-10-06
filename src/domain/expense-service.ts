import { nowISO } from "../core/dates";
import { uid } from "../core/id";
import { sumCents, toCents, toPesos, type Cents } from "../core/money";
import type { Expense, ExpensePeriod } from "../core/types";
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

const WEEK_MS = 7 * 86_400_000;

export function expensePeriod(expense: Pick<Expense, "period">): ExpensePeriod {
  return expense.period === "semanal" ? "semanal" : "mensual";
}

/** Lunes 00:00 local de la semana de `d`. */
export function weekStart(d: Date): Date {
  const day = (d.getDay() + 6) % 7;
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() - day);
}

export function daysInMonth(d: Date): number {
  return new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
}

/**
 * Parte de los costos fijos que corresponde al rango [start, end).
 * Mensual: aplica desde el mes en que se registró y se reparte por la fracción
 * del mes cubierta (un día = monto / días del mes).
 * Semanal: aplica desde la semana en que se registró (un día = monto / 7).
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
    if (expensePeriod(expense) === "semanal") {
      const from = Math.max(rangeStart, Number.isNaN(created.getTime()) ? rangeStart : weekStart(created).getTime());
      if (rangeEnd > from) total += (monthly * (rangeEnd - from)) / WEEK_MS;
      continue;
    }
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

/** ¿Es un pago de nómina (sueldos, salarios)? Por categoría o concepto. */
export function isPayroll(expense: Pick<Expense, "category" | "concept">): boolean {
  const text = `${expense.category} ${expense.concept}`.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  return /sueldo|nomina|salario|raya|pago de empleados|empleado/.test(text);
}

/** Monto semanal de un costo fijo: el semanal tal cual; el mensual × 12 ÷ 52. */
export function weeklyCents(expense: Pick<Expense, "amount" | "period">): Cents {
  const cents = toCents(expense.amount);
  return expensePeriod(expense) === "semanal" ? cents : Math.round((cents * 12) / 52);
}

/**
 * Meta de nómina de la semana (lunes a domingo): cuánta ganancia hace falta
 * para pagar sueldos y cuánto por día en lo que queda de la semana.
 */
export function payrollProgress(weeklyPayrollCents: Cents, earnedCents: Cents, now = new Date()): {
  goal: Cents;
  earned: Cents;
  missing: Cents;
  progress: number;
  daysLeft: number;
  perDay: Cents;
} {
  const dayIndex = (now.getDay() + 6) % 7; // lunes = 0
  const daysLeft = 7 - dayIndex; // incluye hoy
  const missing = Math.max(0, weeklyPayrollCents - earnedCents);
  return {
    goal: weeklyPayrollCents,
    earned: earnedCents,
    missing,
    progress: weeklyPayrollCents > 0 ? Math.max(0, Math.min(100, Math.round((earnedCents / weeklyPayrollCents) * 100))) : 0,
    daysLeft,
    perDay: missing > 0 ? Math.ceil(missing / daysLeft) : 0
  };
}

/** Monto diario para cubrir costos mensuales (÷ días del mes) y semanales (÷ 7). */
export function dailyTargetCents(monthlyCents: Cents, date = new Date(), weeklyCents: Cents = 0): Cents {
  return Math.round(monthlyCents / daysInMonth(date) + weeklyCents / 7);
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

  /** Suma de costos fijos por frecuencia (montos tal cual, en centavos). */
  fixedBreakdown(scope: string = this.branches.operationalId()): { monthly: Cents; weekly: Cents } {
    const fixed = this.fixedCosts(scope);
    const sum = (period: ExpensePeriod): Cents =>
      sumCents(fixed.filter((expense) => expensePeriod(expense) === period).map((expense) => toCents(expense.amount)));
    return { monthly: sum("mensual"), weekly: sum("semanal") };
  }

  /** Equivalente mensual de todos los costos fijos (semanal × días del mes ÷ 7). */
  monthlyFixedCents(scope: string = this.branches.operationalId(), date = new Date()): Cents {
    const { monthly, weekly } = this.fixedBreakdown(scope);
    return Math.round(monthly + (weekly * daysInMonth(date)) / 7);
  }

  /** Nómina de la semana: costos fijos de sueldos (los mensuales se pasan a semana). */
  payroll(scope: string = this.branches.operationalId()): { weekly: Cents; items: Expense[] } {
    const items = this.fixedCosts(scope).filter(isPayroll);
    return { weekly: sumCents(items.map(weeklyCents)), items };
  }

  dailyTargetCents(scope: string = this.branches.operationalId(), date = new Date()): Cents {
    const { monthly, weekly } = this.fixedBreakdown(scope);
    return dailyTargetCents(monthly, date, weekly);
  }

  add(kind: "fijo" | "extra", concept: string, amountPesos: number, category: string, period: ExpensePeriod = "mensual"): SimpleResult {
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
      ...(kind === "fijo" ? { period } : {}),
      created_at: ts,
      updated_at: ts
    });
    return { ok: true };
  }

  update(id: string, changes: { concept: string; amount: number; category: string; period?: ExpensePeriod }): SimpleResult {
    const expense = this.repos.expenses.byId(id);
    if (!expense || expense.deleted) return { ok: false, error: "No se encontró el gasto" };
    const amount = toPesos(toCents(changes.amount));
    if (!changes.concept.trim()) return { ok: false, error: "Escribe el concepto" };
    if (!Number.isFinite(amount) || amount <= 0) return { ok: false, error: "Monto inválido" };
    this.repos.expenses.upsert({
      ...expense,
      concept: changes.concept.trim(),
      amount,
      category: changes.category,
      ...(isFixedCost(expense) && changes.period ? { period: changes.period } : {}),
      updated_at: nowISO()
    });
    return { ok: true };
  }

  remove(id: string): SimpleResult {
    const expense = this.repos.expenses.byId(id);
    if (!expense || expense.deleted) return { ok: false, error: "No se encontró el gasto" };
    this.repos.expenses.softDelete(id);
    return { ok: true };
  }
}
