import { toCents, toPesos, sumCents } from "../core/money";
import { normalizeQty } from "../core/qty";
import type { PeriodReport, ProductSaleStat, Sale } from "../core/types";
import type { Repositories } from "../data/repositories";
import { VIEW_ALL } from "./app-state";
import type { AppState } from "./app-state";
import type { Store } from "./store";

interface CacheEntry {
  version: number;
  report: PeriodReport;
}

/**
 * Reportes por rango y alcance (sucursal o consolidado), memoizados por
 * (alcance, rango, versión-de-datos). Cualquier cambio de estado sube la
 * versión y el siguiente cálculo refresca.
 */
export class ReportService {
  private cache = new Map<string, CacheEntry>();
  private version = 0;

  constructor(
    private repos: Repositories,
    store: Store<AppState>
  ) {
    store.subscribe(() => {
      this.version += 1;
    });
  }

  periodReport(scope: string, start: string, end: string): PeriodReport {
    const key = `${scope}|${start}|${end}`;
    const cached = this.cache.get(key);
    if (cached && cached.version === this.version) return cached.report;
    const report = this.compute(scope, start, end);
    if (this.cache.size > 60) this.cache.clear();
    this.cache.set(key, { version: this.version, report });
    return report;
  }

  monthReport(scope: string, month: string): PeriodReport {
    const [yearRaw, monthRaw] = month.split("-").map(Number);
    const year = yearRaw ?? 1970;
    const monthIndex = (monthRaw ?? 1) - 1;
    const start = new Date(year, monthIndex, 1).toISOString();
    const end = new Date(year, monthIndex + 1, 1).toISOString();
    return this.periodReport(scope, start, end);
  }

  private compute(scope: string, start: string, end: string): PeriodReport {
    const inScope = (branchId: string | undefined): boolean =>
      scope === VIEW_ALL || !branchId || branchId === scope;
    const inRange = (createdAt: string): boolean => createdAt >= start && createdAt < end;
    const sales = this.repos.sales.list().filter((sale) => inScope(sale.branch_id) && inRange(sale.created_at));
    const expenses = this.repos.expenses.list().filter((expense) => inScope(expense.branch_id) && inRange(expense.created_at));
    const purchases = this.repos.purchases.list().filter((purchase) => inScope(purchase.branch_id) && inRange(purchase.created_at));
    const mermas = this.repos.mermas.list().filter((merma) => inScope(merma.branch_id) && inRange(merma.created_at));
    const centsOf = (rows: Array<{ total: number }>): number => sumCents(rows.map((row) => toCents(row.total)));
    const salesTotalCents = centsOf(sales);
    const salesCostCents = sumCents(sales.map((sale) => toCents(sale.cost)));
    const expensesTotalCents = sumCents(expenses.map((expense) => toCents(expense.amount)));
    const purchasesTotalCents = centsOf(purchases);
    const stats = this.productStats(sales);
    return {
      start,
      end,
      branch_id: scope,
      sales_total: toPesos(salesTotalCents),
      sales_cost: toPesos(salesCostCents),
      gross_profit: toPesos(salesTotalCents - salesCostCents),
      expenses_total: toPesos(expensesTotalCents),
      purchases_total: toPesos(purchasesTotalCents),
      mermas_total: toPesos(sumCents(mermas.map((merma) => toCents(merma.cost_impact)))),
      mermas_count: mermas.length,
      profit_after_expenses: toPesos(salesTotalCents - salesCostCents - expensesTotalCents),
      credit_total: toPesos(centsOf(sales.filter((sale) => sale.payment === "fiado"))),
      sales_count: sales.length,
      expenses_count: expenses.length,
      purchases_count: purchases.length,
      top_products: stats.top,
      slow_products: stats.slow
    };
  }

  private productStats(sales: Sale[]): { top: ProductSaleStat[]; slow: ProductSaleStat[] } {
    const byProduct = new Map<string, ProductSaleStat>();
    sales.forEach((sale) => {
      (sale.items ?? []).forEach((item) => {
        const current = byProduct.get(item.productId) ?? {
          id: item.productId,
          name: item.name,
          qty: 0,
          total: 0,
          um: item.um
        };
        current.qty = normalizeQty(current.qty + normalizeQty(item.qty));
        current.total = toPesos(sumCents([toCents(current.total), Math.round(normalizeQty(item.qty) * toCents(item.price))]));
        byProduct.set(item.productId, current);
      });
    });
    const activeProducts = this.repos.products.list().filter((product) => product.active !== false);
    const slow: ProductSaleStat[] = activeProducts.map((product) => {
      const sold = byProduct.get(product.id);
      return sold ?? { id: product.id, name: product.name, qty: 0, total: 0, um: product.um };
    });
    return {
      top: [...byProduct.values()].sort((a, b) => b.qty - a.qty || b.total - a.total).slice(0, 10),
      slow: slow.sort((a, b) => a.qty - b.qty || a.name.localeCompare(b.name)).slice(0, 10)
    };
  }
}
