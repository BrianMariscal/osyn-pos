import { fmtDateTime } from "../../../core/dates";
import { html, setHtml } from "../../../core/html";
import { fmtMoneyPesos } from "../../../core/money";
import { fmtQty } from "../../../core/qty";
import { paginate, pagerMarkup } from "../../pager";
import { type ProveedoresScene } from "./scene";

export function renderPurchases(scene: ProveedoresScene): void {
  const { ctx, ui, state } = scene;
  const branchId = ctx.branches.operationalId();
  const purchases = ctx.repos.purchases
    .list()
    .filter((purchase) => purchase.branch_id === branchId)
    .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at));
  ui.purchasesCount.textContent = purchases.length ? `${purchases.length} en esta sucursal` : "";
  const purchasesPage = <T,>(rows: T[]) => paginate(rows, state.purchasePage, 10);
  setHtml(
    ui.list,
    purchases.length
      ? html`${purchasesPage(purchases).items.map(
          (purchase) => html`
            <div class="list-item">
              <div class="item-line">
                <strong>${purchase.supplier}</strong>
                <strong>${fmtMoneyPesos(purchase.total)}</strong>
              </div>
              ${purchase.paid_from === "aparte" ? html`<span class="tag">Pagada aparte</span>` : html``}
              <p class="muted">${purchase.product_name} | ${fmtQty(purchase.qty)} ${purchase.um ?? "Pza"}${purchase.packs ? ` (${fmtQty(purchase.packs)} ${purchase.packs === 1 ? "caja" : "cajas"} de ${fmtQty(purchase.pack_size ?? 0)})` : ""} | ${fmtDateTime(purchase.created_at)}</p>
            </div>
          `
        )}${pagerMarkup("purchases", purchasesPage(purchases))}`
      : html`<p class="muted">Sin compras registradas.</p>`
  );
}
