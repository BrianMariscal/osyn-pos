import { fmtDateTime } from "../../../core/dates";
import { html, setHtml } from "../../../core/html";
import { fmtMoneyPesos, sumCents, toCents, toPesos } from "../../../core/money";
import { fmtQty, normalizeQty } from "../../../core/qty";
import { paginate, pagerMarkup } from "../../pager";
import { type InventarioScene } from "./scene";

/** Texto de la diferencia entre lo capturado y la existencia. */
export function diffText(diff: number | null, um: string): ReturnType<typeof html> {
  if (diff === null) return html`Diferencia: sin capturar`;
  const sign = diff > 0 ? "+" : "";
  const cls = diff < 0 ? "diff-negative" : diff > 0 ? "diff-positive" : "muted";
  return html`Diferencia: <span class="${cls}">${sign}${fmtQty(diff)} ${um}</span>`;
}

export function renderSummary(scene: InventarioScene): void {
  const { ctx, ui } = scene;
  const branchId = ctx.branches.operationalId();
  const rows = ctx.repos.stocks.list().filter((row) => row.branch_id === branchId);
  const withProduct = rows
    .map((row) => ({ row, product: ctx.repos.products.byId(row.product_id) }))
    .filter((entry): entry is { row: typeof rows[number]; product: NonNullable<typeof entry.product> } =>
      Boolean(entry.product && entry.product.active !== false)
    );
  const costCents = sumCents(withProduct.map(({ row, product }) => Math.round(row.stock * toCents(product.cost))));
  const saleCents = sumCents(withProduct.map(({ row, product }) => Math.round(row.stock * toCents(product.price))));
  const low = withProduct.filter(({ row }) => row.stock <= row.min_stock);
  setHtml(
    ui.summaryEl,
    html`
      <div><span>Productos activos</span><strong>${withProduct.length}</strong></div>
      <div><span>Productos bajos</span><strong>${low.length}</strong></div>
      <div><span>Valor a costo</span><strong>${fmtMoneyPesos(toPesos(costCents))}</strong></div>
      <div><span>Valor a venta</span><strong>${fmtMoneyPesos(toPesos(saleCents))}</strong></div>
      <div><span>Ganancia potencial</span><strong>${fmtMoneyPesos(toPesos(saleCents - costCents))}</strong></div>
    `
  );
}

export function renderCountSummary(scene: InventarioScene): void {
  const { ctx, ui } = scene;
  const summary = ctx.inventory.summary();
  const total = ctx.repos.products.list().filter((product) => product.active !== false).length;
  if (!summary) {
    setHtml(ui.countSummaryEl, html`<p class="muted">No hay conteo activo.</p>`);
    return;
  }
  setHtml(
    ui.countSummaryEl,
    html`
      <div><span>Estado</span><strong>Conteo en proceso · desde ${fmtDateTime(ctx.inventory.activeCount()?.started_at)}</strong></div>
      <div><span>Productos capturados</span><strong>${summary.captured} de ${total}</strong></div>
      <div><span>Con faltante</span><strong>${summary.shortage}</strong></div>
      <div><span>Con sobrante</span><strong>${summary.surplus}</strong></div>
      <div><span>Ajustes a aplicar</span><strong>${summary.adjusted}</strong></div>
    `
  );
}

export function renderList(scene: InventarioScene): void {
  const { ctx, ui, filters, state } = scene;
  const branchId = ctx.branches.operationalId();
  const counting = Boolean(ctx.inventory.activeCount());
  ui.onlyDiffBox.classList.toggle("hidden", !counting);
  // Todos los productos activos: los que aún no tienen existencia en esta
  // sucursal también se pueden contar (antes no aparecían).
  const stockByProduct = new Map(
    ctx.repos.stocks.list().filter((row) => row.branch_id === branchId).map((row) => [row.product_id, row])
  );
  filters.refresh();
  let rows = filters
    .apply(ctx.repos.products.list().filter((product) => product.active !== false), ui.search.value)
    .map((product) => ({
      product,
      row: stockByProduct.get(product.id) ?? { stock: 0, min_stock: 0 }
    }));
  const onlyDifferences = counting && ui.onlyDiff.checked;
  if (onlyDifferences) {
    rows = rows.filter(({ product, row }) => {
      const counted = ctx.inventory.countedValue(product.id);
      if (counted === undefined || counted.trim() === "") return false;
      const system = ctx.inventory.baselineFor(product.id) ?? row.stock;
      return Math.abs(normalizeQty(counted) - normalizeQty(system)) > 0.0001;
    });
  }
  if (!rows.length) {
    setHtml(
      ui.listEl,
      html`<p class="muted">${onlyDifferences
        ? "Sin diferencias capturadas."
        : ui.search.value.trim() || filters.active()
          ? "Ningún producto coincide."
          : "Sin productos en inventario."}</p>`
    );
    return;
  }
  // Sin conteo: de 15 en 15. Durante el conteo se ven todos (Enter pasa al siguiente).
  const page = paginate(rows, counting ? 0 : state.listPage, counting ? Math.max(rows.length, 1) : 15);
  setHtml(
    ui.listEl,
    html`${page.items.map(({ row, product }) => {
      const counted = counting ? ctx.inventory.countedValue(product!.id) : undefined;
      const systemStock = ctx.inventory.baselineFor(product!.id) ?? row.stock;
      const diff =
        counted === undefined || counted === ""
          ? null
          : Math.round((normalizeQty(counted) - normalizeQty(systemStock)) * 100) / 100;
      return html`
        <div class="list-item ${row.stock <= row.min_stock ? "low" : ""}">
          <div class="item-line">
            <strong>${product!.name}</strong>
            <strong>${fmtQty(counting ? (ctx.inventory.baselineFor(product!.id) ?? row.stock) : row.stock)} ${product!.um}</strong>
          </div>
          <p class="muted">${product!.category || "Sin categoría"} | Mín ${fmtQty(row.min_stock)} | Costo ${fmtMoneyPesos(product!.cost)} | Venta ${fmtMoneyPesos(product!.price)}</p>
          ${counting
            ? html`
                <div class="item-line">
                  <label class="count-label">Físico
                    <input class="input count-input" name="conteo" type="number" step="0.01" min="0" inputmode="decimal" enterkeyhint="next" value="${counted ?? ""}" data-count-product="${product!.id}" placeholder="—" aria-label="Cantidad física de ${product!.name}">
                  </label>
                  <p class="muted" data-diff-for="${product!.id}">${diffText(diff, product!.um)}</p>
                </div>
              `
            : html``}
        </div>
      `;
    })}${pagerMarkup("inventory", page)}`
  );
}

export function renderHistory(scene: InventarioScene): void {
  const { ctx, ui } = scene;
  const history = ctx.inventory.history();
  setHtml(
    ui.historyEl,
    history.length
      ? html`${history.slice(0, 12).map(
          (count) => html`
            <div class="list-item">
              <div class="item-line"><strong>${fmtDateTime(count.applied_at)}</strong><strong>${count.summary.adjusted ?? 0} ajustes</strong></div>
              <p class="muted">Faltantes ${count.summary.shortage ?? 0} | Sobrantes ${count.summary.surplus ?? 0} | Impacto costo ${fmtMoneyPesos(count.summary.costImpact ?? 0)}</p>
            </div>
          `
        )}`
      : html`<p class="muted">Aún no hay conteos aplicados.</p>`
  );
}

export function renderAll(scene: InventarioScene): void {
  renderSummary(scene);
  renderCountSummary(scene);
  if (scene.isTypingCount()) scene.state.pendingListRender = true;
  else renderList(scene);
  renderHistory(scene);
}
