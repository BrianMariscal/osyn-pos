import { html, setHtml } from "../../core/html";
import { fmtDateTime } from "../../core/dates";
import { fmtMoneyPesos } from "../../core/money";
import { fmtQty } from "../../core/qty";
import { supplierLabel } from "../../domain/catalog";
import { iconFor } from "../icons";
import { mountPurchaseLines } from "../purchase-lines";
import type { TabModule } from "./tab-module";

/** Entradas: recepción de mercancía (suma stock, registra compra). Para todo el personal. */
export const entradasTab: TabModule = {
  id: "entradas",
  render(root, ctx) {
    setHtml(
      root,
      html`
        <div class="split">
          <article class="card">
            <h2>Recibir mercancía</h2>
            <p class="hint">Cuando llegue mercancía, registra la entrada: suma existencia en esta sucursal y queda en reportes. Si el producto tiene piezas por caja, captura las cajas y se calculan las piezas.</p>
            <form id="receiveForm" class="form">
              <label class="form-field">Proveedor
                <select id="receiveSupplier" class="input"></select>
              </label>
              <div class="section-title"><h3>Productos recibidos</h3><button id="addReceiveLine" class="ghost" type="button">${iconFor("plus")} Agregar producto</button></div>
              <div id="receiveLines" class="purchase-lines"></div>
              <button class="primary" type="submit">${iconFor("arrowDown")} Registrar entrada completa</button>
            </form>
          </article>

          <article class="card">
            <h2>Últimas entradas</h2>
            <p class="hint" id="entradasBranch"></p>
            <div id="receiveList" class="list"></div>
          </article>
        </div>
      `
    );

    const form = root.querySelector<HTMLFormElement>("#receiveForm")!;
    const linesEl = root.querySelector<HTMLElement>("#receiveLines")!;
    const supplierSelect = root.querySelector<HTMLSelectElement>("#receiveSupplier")!;
    const listEl = root.querySelector<HTMLElement>("#receiveList")!;
    const branchEl = root.querySelector<HTMLElement>("#entradasBranch")!;

    const lines = mountPurchaseLines(linesEl, ctx, { requireTotal: false, supplierId: () => supplierSelect.value });

    const renderSuppliers = (): void => {
      const selected = supplierSelect.value;
      const suppliers = ctx.repos.suppliers.list().sort((a, b) => (a.number ?? 0) - (b.number ?? 0) || a.name.localeCompare(b.name));
      setHtml(
        supplierSelect,
        html`<option value="">Entrada de inventario (sin proveedor)</option>${suppliers.map(
          (s) => html`<option value="${s.id}" ${s.id === selected ? "selected" : null}>${supplierLabel(s)}</option>`
        )}`
      );
    };

    const renderList = (): void => {
      const branchId = ctx.branches.operationalId();
      branchEl.textContent = `Sucursal: ${ctx.branches.name(branchId)}`;
      const purchases = ctx.repos.purchases
        .list()
        .filter((purchase) => purchase.branch_id === branchId)
        .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at))
        .slice(0, 30);
      setHtml(
        listEl,
        purchases.length
          ? html`${purchases.map(
              (purchase) => html`
                <div class="list-item">
                  <div class="item-line">
                    <strong>${purchase.product_name}</strong>
                    <strong>+${fmtQty(purchase.qty)} ${purchase.um ?? "Pza"}</strong>
                  </div>
                  <p class="muted">${purchase.supplier}${purchase.packs ? ` | ${fmtQty(purchase.packs)} ${purchase.packs === 1 ? "caja" : "cajas"} de ${fmtQty(purchase.pack_size ?? 0)}` : ""} | ${fmtMoneyPesos(purchase.total)} | ${fmtDateTime(purchase.created_at)}</p>
                </div>
              `
            )}`
          : html`<p class="muted">Sin entradas registradas. Aquí verás la mercancía que recibas.</p>`
      );
    };

    root.querySelector<HTMLButtonElement>("#addReceiveLine")!.addEventListener("click", () => lines.addLine());
    supplierSelect.addEventListener("change", () => lines.render());

    form.addEventListener("submit", (event) => {
      event.preventDefault();
      const read = lines.read();
      if (!read.ok) {
        ctx.toast(read.error);
        return;
      }
      const supplier = ctx.repos.suppliers.byId(supplierSelect.value);
      const result = ctx.inventory.receiveStockMany(read.items, supplier?.name ?? "");
      if (!result.ok) {
        ctx.toast(result.error);
        return;
      }
      lines.reset();
      ctx.toast(`${result.count} productos recibidos: +${fmtQty(result.qty)}`);
    });

    ctx.store.watch((s) => s.suppliers, () => {
      renderSuppliers();
      lines.render();
    });
    ctx.store.watch((s) => s.products, () => lines.render());
    ctx.store.watch((s) => [s.purchases, s.branches, s.currentBranchId] as const, renderList);
  }
};
