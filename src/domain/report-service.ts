import { toCents, toPesos, sumCents, lineTotalCents } from "../core/money";
import { roundQty4 } from "../core/qty";
import type { PeriodReport, ProductSaleStat, Sale, SaleGroup } from "../core/types";
import type { Repositories } from "../data/repositories";
import { VIEW_ALL } from "./app-state";
import type { AppState } from "./app-state";
import type { Store } from "./store";
import { fixedCostsForRange, isFixedCost } from "./expense-service";
import { groupTotalsCents, isInternalSale, isRevenueSale, itemGroup } from "./sale-groups";

interface CacheEntry {
  version: number;
  report: PeriodReport;
}

/**
 * Reportes por rango y alcance (sucursal o consolidado), memoizados por
 * (alcance, rango, versión-de-datos). La versión solo sube cuando cambian
 * los datos que usan los reportes (no con el carrito ni el estado de sync).
 */
export class ReportService {
  private cache = new Map<string, CacheEntry>();
  private version = 0;

  constructor(
    private repos: Repositories,
    store: Store<AppState>
  ) {
    const inputs = (state: AppState): unknown[] => [state.sales, state.returns, state.expenses, state.purchases, state.mermas, state.products];
    let last = inputs(store.getState());
    store.subscribe(() => {
      const next = inputs(store.getState());
      if (next.some((value, index) => value !== last[index])) {
        last = next;
        this.version += 1;
      }
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
    const scopedSales = this.repos.sales.list().filter((sale) => inScope(sale.branch_id) && inRange(sale.created_at));
    // La venta interna (consumo de la tienda) baja inventario pero no es ingreso.
    const sales = scopedSales.filter(isRevenueSale);
    const internal = scopedSales.filter(isInternalSale);
    const scopedExpenses = this.repos.expenses.list().filter((expense) => inScope(expense.branch_id));
    const extras = scopedExpenses.filter((expense) => !isFixedCost(expense) && inRange(expense.created_at));
    const fixedCents = fixedCostsForRange(scopedExpenses, start, end);
    const purchases = this.repos.purchases.list().filter((purchase) => inScope(purchase.branch_id) && inRange(purchase.created_at));
    const mermas = this.repos.mermas.list().filter((merma) => inScope(merma.branch_id) && inRange(merma.created_at));
    const returns = this.repos.returns.list().filter((ret) => inScope(ret.branch_id) && inRange(ret.created_at));
    const centsOf = (rows: Array<{ total: number }>): number => sumCents(rows.map((row) => toCents(row.total)));
    const salesTotalCents = centsOf(sales);
    const salesCostCents = sumCents(sales.map((sale) => toCents(sale.cost)));
    const extraCents = sumCents(extras.map((expense) => toCents(expense.amount)));
    const expensesTotalCents = extraCents + fixedCents;
    const purchasesTotalCents = centsOf(purchases);
    // Devoluciones: revierten ingreso y costo. Las ventas y el costo del
    // periodo se reportan NETOS (la ganancia bruta ya venía neta).
    const returnsTotalCents = centsOf(returns);
    const returnsCostCents = sumCents(returns.map((ret) => toCents(ret.cost)));
    const grossProfitCents = salesTotalCents - salesCostCents - (returnsTotalCents - returnsCostCents);
    const groups = groupTotalsCents(sales, (id) => this.repos.products.byId(id));
    const returnedGroups: Record<SaleGroup, number> = { general: 0, cigarros: 0, cerveza: 0 };
    for (const ret of returns) {
      for (const item of ret.items ?? []) {
        returnedGroups[itemGroup(item, (id) => this.repos.products.byId(id))] += lineTotalCents(item.qty, item.price);
      }
    }
    const stats = this.productStats(sales);
    return {
      start,
      end,
      branch_id: scope,
      sales_total: toPesos(salesTotalCents - returnsTotalCents),
      sales_cost: toPesos(salesCostCents - returnsCostCents),
      gross_profit: toPesos(grossProfitCents),
      expenses_total: toPesos(expensesTotalCents),
      fixed_costs_total: toPesos(fixedCents),
      extra_expenses_total: toPesos(extraCents),
      cigarros_total: toPesos(groups.cigarros - returnedGroups.cigarros),
      cerveza_total: toPesos(groups.cerveza - returnedGroups.cerveza),
      internal_total: toPesos(sumCents(internal.map((sale) => toCents(sale.cost)))),
      purchases_total: toPesos(purchasesTotalCents),
      mermas_total: toPesos(sumCents(mermas.map((merma) => toCents(merma.cost_impact)))),
      mermas_count: mermas.length,
      returns_total: toPesos(returnsTotalCents),
      returns_cost: toPesos(returnsCostCents),
      returns_count: returns.length,
      profit_after_expenses: toPesos(grossProfitCents - expensesTotalCents),
      credit_total: toPesos(centsOf(sales.filter((sale) => sale.payment === "fiado"))),
      sales_count: sales.length,
      expenses_count: extras.length,
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
        // Cajas cuentan como sus piezas; el total cuadra al centavo como la venta.
        current.qty = roundQty4(current.qty + roundQty4(item.qty) * (item.pack_size || 1));
        current.total = toPesos(sumCents([toCents(current.total), lineTotalCents(item.qty, item.price)]));
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
