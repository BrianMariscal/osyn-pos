import { nowISO } from "../core/dates";
import { uid } from "../core/id";
import { toCents, toPesos } from "../core/money";
import { fmtQty, normalizeQty } from "../core/qty";
import { MERMA_REASONS, DEFAULT_BRANCH_ID, type CountIncidence, type CountSummary, type InventoryCount, type Merma, type MermaReason, type Purchase } from "../core/types";
import type { Repositories } from "../data/repositories";
import type { BranchService } from "./branch-service";

export interface ActiveCount {
  id: string;
  branch_id: string;
  started_at: string;
  items: Record<string, string>;
}

export type ApplyCountResult = { ok: true; count: InventoryCount } | { ok: false; error: string };
export interface StockReceipt {
  productId: string;
  qty: number;
  totalPaid: number;
}

/**
 * Conteo físico por sucursal. El conteo activo es transitorio (no se sincroniza);
 * lo que se sincroniza es el registro aplicado con sus incidencias.
 */
export class InventoryService {
  private active: ActiveCount | null = null;
  /** Aviso dirigido (para actualizar solo la fila tocada sin re-render completo). */
  onCountChange: ((productId: string) => void) | null = null;

  constructor(
    private repos: Repositories,
    private branches: BranchService
  ) {}

  isActive(): boolean {
    return this.active !== null;
  }

  /**
   * Productos heredados con stock en la fila vieja pero SIN filas de
   * existencia: crea sus filas en la sucursal por defecto y las marca para sync.
   * Devuelve cuántos productos se recuperaron.
   */
  backfillFromProducts(): number {
    const withRows = new Set(this.repos.stocks.all().map((row) => row.product_id));
    const legacy = this.repos.products.list().filter(
      (product) => !withRows.has(product.id) && normalizeQty(product.stock ?? 0) > 0
    );
    const ts = nowISO();
    legacy.forEach((product) => {
      this.repos.stocks.upsert({
        id: `${product.id}:${DEFAULT_BRANCH_ID}`,
        product_id: product.id,
        branch_id: DEFAULT_BRANCH_ID,
        stock: normalizeQty(product.stock ?? 0),
        min_stock: normalizeQty(product.min_stock ?? 0),
        updated_at: ts
      });
    });
    return legacy.length;
  }

  /** El conteo activo solo aplica a la sucursal operativa actual. */
  activeCount(): ActiveCount | null {
    if (!this.active) return null;
    return this.active.branch_id === this.branches.operationalId() ? this.active : null;
  }

  start(): void {
    this.active = { id: uid(), branch_id: this.branches.operationalId(), started_at: nowISO(), items: {} };
  }

  setCount(productId: string, value: string): void {
    if (!this.active) return;
    this.active.items = { ...this.active.items, [productId]: value };
    this.onCountChange?.(productId);
  }

  cancel(): void {
    this.active = null;
  }

  countedValue(productId: string): string | undefined {
    return this.activeCount()?.items[productId];
  }

  summary(): CountSummary | null {
    const active = this.activeCount();
    if (!active) return null;
    const incidences: CountIncidence[] = [];
    let captured = 0;
    let ok = 0;
    let shortage = 0;
    let surplus = 0;
    let costImpactCents = 0;
    let saleImpactCents = 0;
    const branchId = active.branch_id;
    for (const product of this.repos.products.list()) {
      if (product.active === false) continue;
      const raw = active.items[product.id];
      if (raw === undefined || raw === "") continue;
      captured += 1;
      const physical = normalizeQty(raw);
      const systemStock = this.repos.stocks
        .list()
        .find((row) => row.product_id === product.id && row.branch_id === branchId);
      const system = normalizeQty(systemStock?.stock ?? 0);
      const difference = Math.round((physical - system) * 1000) / 1000;
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

  apply(): ApplyCountResult {
    const active = this.activeCount();
    if (!active) return { ok: false, error: "Primero inicia un conteo" };
    const summary = this.summary();
    if (!summary || !summary.captured) return { ok: false, error: "Captura cantidades físicas primero" };
    const ts = nowISO();
    for (const incidence of summary.incidences) {
      const stockRow = this.repos.stocks
        .list()
        .find((row) => row.product_id === incidence.product_id && row.branch_id === active.branch_id);
      if (stockRow) {
        this.repos.stocks.upsert({ ...stockRow, stock: normalizeQty(incidence.physical_stock), updated_at: ts });
      }
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
    this.repos.counts.upsert(count);
    this.active = null;
    return { ok: true, count };
  }

  history(): InventoryCount[] {
    const branchId = this.branches.operationalId();
    return this.repos.counts
      .list()
      .filter((count) => count.branch_id === branchId)
      .sort((a, b) => Date.parse(b.applied_at) - Date.parse(a.applied_at));
  }

  /** Admin: stock de todas las sucursales de un producto (vista consolidada). */
  stockEverywhere(productId: string): Array<{ branch_id: string; stock: number; min_stock: number }> {
    return this.repos.stocks
      .list()
      .filter((row) => row.product_id === productId)
      .map((row) => ({ branch_id: row.branch_id, stock: normalizeQty(row.stock), min_stock: normalizeQty(row.min_stock) }));
  }

  /** Entrada de mercancía: suma stock y registra la compra para reportes. */
  receiveStock(productId: string, qty: number, supplierName: string, totalPaid: number): { ok: true; qty: number } | { ok: false; error: string } {
    const product = this.repos.products.byId(productId);
    if (!product) return { ok: false, error: "No se encontró el producto" };
    const quantity = normalizeQty(qty);
    if (!Number.isFinite(qty) || quantity <= 0) return { ok: false, error: "Cantidad inválida" };
    if (!Number.isFinite(totalPaid) || totalPaid < 0) return { ok: false, error: "Total pagado inválido" };
    const branchId = this.branches.operationalId();
    const ts = nowISO();
    const stockId = `${productId}:${branchId}`;
    const stockRow = this.repos.stocks.list().find((row) => row.id === stockId);
    const previousStock = normalizeQty(stockRow?.stock ?? 0);
    this.repos.stocks.upsert({
      id: stockId,
      product_id: productId,
      branch_id: branchId,
      stock: normalizeQty(previousStock + quantity),
      min_stock: stockRow?.min_stock ?? 0,
      updated_at: ts
    });
    if (totalPaid > 0 && previousStock + quantity > 0) {
      const averageCost = (previousStock * product.cost + totalPaid) / (previousStock + quantity);
      this.repos.products.upsert({ ...product, cost: toPesos(Math.round(toCents(averageCost))), updated_at: ts });
    }
    const purchase: Purchase = {
      id: uid(),
      branch_id: branchId,
      supplier: supplierName.trim() || "Entrada de inventario",
      product_id: product.id,
      product_name: product.name,
      um: product.um,
      qty: quantity,
      total: Math.round(totalPaid * 100) / 100,
      created_at: ts,
      updated_at: ts
    };
    this.repos.purchases.upsert(purchase);
    return { ok: true, qty: quantity };
  }

  /** Recibe varias líneas de una misma entrega y registra cada compra. */
  receiveStockMany(items: StockReceipt[], supplierName: string): { ok: true; count: number; qty: number } | { ok: false; error: string } {
    if (!items.length) return { ok: false, error: "Agrega al menos un producto" };
    for (const item of items) {
      if (!this.repos.products.byId(item.productId)) return { ok: false, error: "No se encontró uno de los productos" };
      if (!Number.isFinite(item.qty) || item.qty <= 0) return { ok: false, error: "Hay una cantidad inválida" };
      if (!Number.isFinite(item.totalPaid) || item.totalPaid < 0) return { ok: false, error: "Hay un total pagado inválido" };
    }
    let count = 0;
    let qty = 0;
    for (const item of items) {
      const result = this.receiveStock(item.productId, item.qty, supplierName, item.totalPaid);
      if (!result.ok) return result;
      count += 1;
      qty += result.qty;
    }
    return { ok: true, count, qty };
  }

  /** Merma: producto perdido sin venta; descuenta stock y deja registro. */
  registerMerma(productId: string, qty: number, reason: MermaReason, note: string): { ok: true; merma: Merma } | { ok: false; error: string } {
    const product = this.repos.products.byId(productId);
    if (!product) return { ok: false, error: "No se encontró el producto" };
    if (!(MERMA_REASONS as readonly string[]).includes(reason)) return { ok: false, error: "Motivo inválido" };
    const quantity = normalizeQty(qty);
    if (quantity <= 0) return { ok: false, error: "Cantidad inválida" };
    const branchId = this.branches.operationalId();
    const stockRow = this.repos.stocks.list().find((row) => row.product_id === productId && row.branch_id === branchId);
    const available = normalizeQty(stockRow?.stock ?? 0);
    if (quantity > available) return { ok: false, error: `Solo hay ${fmtQty(available)} ${product.um} en existencia` };
    const ts = nowISO();
    if (stockRow) {
      this.repos.stocks.upsert({ ...stockRow, stock: normalizeQty(available - quantity), updated_at: ts });
    }
    const merma: Merma = {
      id: uid(),
      branch_id: branchId,
      product_id: product.id,
      product_name: product.name,
      um: product.um,
      qty: quantity,
      reason,
      note,
      cost_impact: toPesos(Math.round(quantity * toCents(product.cost))),
      created_at: ts,
      updated_at: ts
    };
    this.repos.mermas.upsert(merma);
    return { ok: true, merma };
  }

  /** Historial de mermas de la sucursal operativa. */
  mermaHistory(limit = 12): Merma[] {
    const branchId = this.branches.operationalId();
    return this.repos.mermas
      .list()
      .filter((merma) => merma.branch_id === branchId)
      .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at))
      .slice(0, limit);
  }
}
