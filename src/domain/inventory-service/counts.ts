import { toCents, toPesos } from "../../core/money";
import type { CountIncidence, CountSummary, InventoryCount } from "../../core/types";
import { normalizeQtyForUnit } from "../../core/units";
import type { Repositories } from "../../data/repositories";
import type { ActiveCount } from "./types";

/** Incidencias y totales del conteo: compara lo capturado contra el sistema. */
export function computeSummary(repos: Repositories, active: ActiveCount): CountSummary {
  const incidences: CountIncidence[] = [];
  let captured = 0;
  let ok = 0;
  let shortage = 0;
  let surplus = 0;
  let costImpactCents = 0;
  let saleImpactCents = 0;
  const branchId = active.branch_id;
  for (const product of repos.products.list()) {
    if (product.active === false) continue;
    const raw = active.items[product.id];
    if (raw === undefined || raw === "") continue;
    captured += 1;
    const physical = normalizeQtyForUnit(raw, product.um);
    const systemStock = repos.stocks
      .list()
      .find((row) => row.product_id === product.id && row.branch_id === branchId);
    const system = normalizeQtyForUnit(systemStock?.stock ?? 0, product.um);
    const difference = Math.round((physical - system) * 10000) / 10000;
    if (difference === 0) {
      ok += 1;
      continue;
    }
    if (difference < 0) shortage += 1;
    else surplus += 1;
    costImpactCents += Math.round(difference * toCents(product.cost));
    saleImpactCents += Math.round(difference * toCents(product.price));
    incidences.push({
      product_id: product.id,
      name: product.name,
      category: product.category,
      um: product.um,
      system_stock: system,
      physical_stock: physical,
      difference,
      cost_impact: toPesos(Math.round(difference * toCents(product.cost))),
      sale_impact: toPesos(Math.round(difference * toCents(product.price)))
    });
  }
  return {
    captured,
    ok,
    shortage,
    surplus,
    adjusted: incidences.length,
    costImpact: toPesos(costImpactCents),
    saleImpact: toPesos(saleImpactCents),
    incidences
  };
}

/** Aplica las diferencias al stock de la sucursal y devuelve el registro del conteo. */
export function applyCount(repos: Repositories, active: ActiveCount, summary: CountSummary, ts: string): InventoryCount {
  for (const incidence of summary.incidences) {
    const stockRow = repos.stocks
      .list()
      .find((row) => row.product_id === incidence.product_id && row.branch_id === active.branch_id);
    const um = repos.products.byId(incidence.product_id)?.um;
    // Producto contado sin fila de existencia en la sucursal: se crea.
    repos.stocks.upsert({
      id: stockRow?.id ?? `${incidence.product_id}:${active.branch_id}`,
      product_id: incidence.product_id,
      branch_id: active.branch_id,
      min_stock: stockRow?.min_stock ?? 0,
      ...stockRow,
      deleted: false,
      stock: normalizeQtyForUnit(incidence.physical_stock, um),
      updated_at: ts
    });
  }
  const count: InventoryCount = {
    id: active.id,
    branch_id: active.branch_id,
    started_at: active.started_at,
    applied_at: ts,
    summary: { ...summary, incidences: [] },
    incidences: summary.incidences,
    updated_at: ts
  };
  repos.counts.upsert(count);
  return count;
}
