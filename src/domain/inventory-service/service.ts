import { nowISO } from "../../core/dates";
import { uid } from "../../core/id";
import { fmtQty } from "../../core/qty";
import { normalizeQtyForUnit } from "../../core/units";
import { MERMA_REASONS, DEFAULT_BRANCH_ID, type CountSummary, type InventoryCount, type Merma, type MermaReason, type PurchasePayment } from "../../core/types";
import type { Repositories } from "../../data/repositories";
import type { BranchService } from "../branch-service";
import { moveStock } from "../stock-moves";
import { applyCount, computeSummary } from "./counts";
import { buildMerma, buildPurchase, withAverageCost } from "./receipts";
import type { ActiveCount, ApplyCountResult, StockReceipt } from "./types";

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
    private branches: BranchService,
    /** ¿El servidor ya mueve el stock por compras/mermas? (ver stock-moves). */
    private serverStock: () => boolean = () => false
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
      (product) => !withRows.has(product.id) && normalizeQtyForUnit(product.stock ?? 0, product.um) > 0
    );
    const ts = nowISO();
    legacy.forEach((product) => {
      this.repos.stocks.upsert({
        id: `${product.id}:${DEFAULT_BRANCH_ID}`,
        product_id: product.id,
        branch_id: DEFAULT_BRANCH_ID,
        stock: normalizeQtyForUnit(product.stock ?? 0, product.um),
        min_stock: normalizeQtyForUnit(product.min_stock ?? 0, product.um),
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

  /** Copia del conteo en curso (para guardarlo y no perderlo al recargar). */
  snapshot(): ActiveCount | null {
    return this.active ? { ...this.active, items: { ...this.active.items } } : null;
  }

  /** Recupera un conteo guardado (solo si sigue siendo válido). */
  restore(saved: unknown): void {
    if (!saved || typeof saved !== "object") return;
    const candidate = saved as Partial<ActiveCount>;
    if (typeof candidate.id !== "string" || typeof candidate.branch_id !== "string" || typeof candidate.started_at !== "string") return;
    const items: Record<string, string> = {};
    Object.entries(candidate.items ?? {}).forEach(([key, value]) => {
      if (typeof value === "string") items[key] = value;
    });
    this.active = { id: candidate.id, branch_id: candidate.branch_id, started_at: candidate.started_at, items };
  }

  countedValue(productId: string): string | undefined {
    return this.activeCount()?.items[productId];
  }

  summary(): CountSummary | null {
    const active = this.activeCount();
    if (!active) return null;
    return computeSummary(this.repos, active);
  }

  apply(): ApplyCountResult {
    const active = this.activeCount();
    if (!active) return { ok: false, error: "Primero inicia un conteo" };
    const summary = this.summary();
    if (!summary || !summary.captured) return { ok: false, error: "Captura cantidades físicas primero" };
    const count = applyCount(this.repos, active, summary, nowISO());
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
    const um = this.repos.products.byId(productId)?.um;
    return this.repos.stocks
      .list()
      .filter((row) => row.product_id === productId)
      .map((row) => ({ branch_id: row.branch_id, stock: normalizeQtyForUnit(row.stock, um), min_stock: normalizeQtyForUnit(row.min_stock, um) }));
  }

  /** Entrada de mercancía: suma stock y registra la compra para reportes. */
  receiveStock(
    productId: string,
    qty: number,
    supplierName: string,
    totalPaid: number,
    pack?: { packs?: number; packSize?: number },
    paidFrom: PurchasePayment = "caja"
  ): { ok: true; qty: number } | { ok: false; error: string } {
    const product = this.repos.products.byId(productId);
    if (!product) return { ok: false, error: "No se encontró el producto" };
    const quantity = normalizeQtyForUnit(qty, product.um);
    if (!Number.isFinite(qty) || quantity <= 0) return { ok: false, error: "Cantidad inválida" };
    if (!Number.isFinite(totalPaid) || totalPaid < 0) return { ok: false, error: "Total pagado inválido" };
    const branchId = this.branches.operationalId();
    const ts = nowISO();
    const stockRow = this.repos.stocks.list().find((row) => row.product_id === productId && row.branch_id === branchId);
    const previousStock = normalizeQtyForUnit(stockRow?.stock ?? 0, product.um);
    const serverStock = this.serverStock();
    moveStock(this.repos, serverStock, productId, branchId, quantity, ts);
    if (totalPaid > 0 && previousStock + quantity > 0) {
      this.repos.products.upsert(withAverageCost(product, previousStock, totalPaid, quantity, ts));
    }
    this.repos.purchases.upsert(buildPurchase({ branchId, supplier: supplierName, product, qty: quantity, totalPaid, pack, paidFrom, serverStock, ts }));
    return { ok: true, qty: quantity };
  }

  /** Recibe varias líneas de una misma entrega y registra cada compra. */
  receiveStockMany(
    items: StockReceipt[],
    supplierName: string,
    paidFrom: PurchasePayment = "caja"
  ): { ok: true; count: number; qty: number } | { ok: false; error: string } {
    if (!items.length) return { ok: false, error: "Agrega al menos un producto" };
    for (const item of items) {
      if (!this.repos.products.byId(item.productId)) return { ok: false, error: "No se encontró uno de los productos" };
      if (!Number.isFinite(item.qty) || item.qty <= 0) return { ok: false, error: "Hay una cantidad inválida" };
      if (!Number.isFinite(item.totalPaid) || item.totalPaid < 0) return { ok: false, error: "Hay un total pagado inválido" };
    }
    let count = 0;
    let qty = 0;
    for (const item of items) {
      const result = this.receiveStock(item.productId, item.qty, supplierName, item.totalPaid, { packs: item.packs, packSize: item.packSize }, paidFrom);
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
    const quantity = normalizeQtyForUnit(qty, product.um);
    if (quantity <= 0) return { ok: false, error: "Cantidad inválida" };
    const branchId = this.branches.operationalId();
    const stockRow = this.repos.stocks.list().find((row) => row.product_id === productId && row.branch_id === branchId);
    const available = normalizeQtyForUnit(stockRow?.stock ?? 0, product.um);
    if (quantity > available) return { ok: false, error: `Solo hay ${fmtQty(available)} ${product.um} en existencia` };
    const ts = nowISO();
    const serverStock = this.serverStock();
    moveStock(this.repos, serverStock, productId, branchId, -quantity, ts);
    const merma = buildMerma({ branchId, product, qty: quantity, reason, note, serverStock, ts });
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
