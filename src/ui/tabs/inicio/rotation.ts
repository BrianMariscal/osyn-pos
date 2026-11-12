import { html, setHtml } from "../../../core/html";
import { fmtQty } from "../../../core/qty";
import { isRevenueSale } from "../../../domain/sale-groups";
import type { InicioScene } from "./scene";

const ROTATION_DAYS = 30;
const VISIBLE = 5;

/**
 * Productos que sí se venden (últimos 30 días) y que ya están en o por debajo
 * de su mínimo. No calcula días ni sugerencias: solo muestra la rotación real
 * para que el dueño sepa qué reponer.
 */
export function renderRotation(scene: InicioScene, scope: string): void {
  const { ctx, ui, inScope } = scene;
  const cutoff = Date.now() - ROTATION_DAYS * 86_400_000;

  const sold = new Map<string, number>();
  for (const sale of ctx.repos.sales.list()) {
    if (!isRevenueSale(sale) || !inScope(scope, sale.branch_id)) continue;
    if (Date.parse(sale.created_at) < cutoff) continue;
    for (const item of sale.items ?? []) {
      sold.set(item.productId, (sold.get(item.productId) ?? 0) + item.qty * (item.pack_size || 1));
    }
  }
  for (const ret of ctx.repos.returns.list()) {
    if (!inScope(scope, ret.branch_id) || Date.parse(ret.created_at) < cutoff) continue;
    for (const item of ret.items ?? []) {
      sold.set(item.productId, (sold.get(item.productId) ?? 0) - item.qty * (item.pack_size || 1));
    }
  }

  const stockByProduct = new Map<string, { stock: number; min: number }>();
  for (const row of ctx.repos.stocks.list()) {
    if (!inScope(scope, row.branch_id)) continue;
    const current = stockByProduct.get(row.product_id) ?? { stock: 0, min: 0 };
    current.stock += row.stock;
    current.min += row.min_stock;
    stockByProduct.set(row.product_id, current);
  }

  const rows = [...sold.entries()]
    .map(([productId, qty]) => {
      const product = ctx.repos.products.byId(productId);
      if (!product || product.deleted || product.active === false) return null;
      const stock = stockByProduct.get(productId) ?? { stock: 0, min: 0 };
      return { product, qty: Math.round(qty * 10_000) / 10_000, stock: stock.stock, min: stock.min };
    })
    .filter((row): row is NonNullable<typeof row> => Boolean(row))
    .filter((row) => row.qty > 0 && (row.min > 0 ? row.stock <= row.min : row.stock <= 0))
    .sort((a, b) => {
      const aOut = a.stock <= 0 ? 0 : 1;
      const bOut = b.stock <= 0 ? 0 : 1;
      if (aOut !== bOut) return aOut - bOut;
      const aRatio = a.min > 0 ? a.stock / a.min : a.stock <= 0 ? -1 : 99;
      const bRatio = b.min > 0 ? b.stock / b.min : b.stock <= 0 ? -1 : 99;
      return aRatio - bRatio || b.qty - a.qty;
    });

  const row = (item: (typeof rows)[number]) => html`
    <div class="rotation-row">
      <span class="rotation-name">
        <strong>${item.product.name}</strong>
        <small class="muted">${item.product.category || "Sin categoría"}</small>
      </span>
      <span class="rotation-sold">${fmtQty(item.qty)} vendidos</span>
      <span class="rotation-stock" data-tone="${item.stock <= 0 ? "coral" : "amber"}">Stock ${fmtQty(item.stock)} · Mín ${fmtQty(item.min)}</span>
    </div>
  `;

  const visible = rows.slice(0, VISIBLE);
  const rest = rows.slice(VISIBLE);

  setHtml(
    ui.rotationCard,
    html`
      <div class="card-head">
        <div>
          <h2>Se venden y están por agotarse</h2>
          <p class="hint">Ventas de los últimos 30 días en o por debajo del mínimo.</p>
        </div>
        ${rows.length ? html`<span class="count-badge" data-tone="coral">${rows.length}</span>` : html``}
      </div>
      ${rows.length
        ? html`
            <div class="rotation-list">${visible.map(row)}</div>
            ${rest.length
              ? html`<details class="rotation-more">
                  <summary>Ver todos (${rows.length})</summary>
                  <div class="rotation-list">${rest.map(row)}</div>
                </details>`
              : html``}
          `
        : html`<p class="empty-note">Ningún producto con rotación está por debajo de su mínimo.</p>`}
    `
  );
}
