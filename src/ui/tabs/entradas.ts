import { html, setHtml } from "../../core/html";
import { fmtDateTime } from "../../core/dates";
import { fmtMoneyPesos } from "../../core/money";
import { fmtQty } from "../../core/qty";
import { iconFor } from "../icons";
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
            <p class="hint">Cuando llegue mercancía, registra la entrada: suma existencia en esta sucursal y queda en reportes.</p>
            <form id="receiveForm" class="form">
              <div class="section-title"><h3>Productos recibidos</h3><button id="addReceiveLine" class="ghost" type="button">+ Agregar producto</button></div>
              <div id="receiveLines" class="form"></div>
              <label class="form-field">Proveedor
                <select id="receiveSupplier" class="input"></select>
              </label>
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
    const addLineButton = root.querySelector<HTMLButtonElement>("#addReceiveLine")!;
    const supplierSelect = root.querySelector<HTMLSelectElement>("#receiveSupplier")!;
    const listEl = root.querySelector<HTMLElement>("#receiveList")!;
    const branchEl = root.querySelector<HTMLElement>("#entradasBranch")!;

    let lineCount = 1;

    const renderLines = (): void => {
      const products = ctx.repos.products.list().filter((p) => p.active !== false);
      const options = products.map((p) => html`<option value="${p.id}">${p.name} (${p.um})</option>`);
      setHtml(
        linesEl,
        html`${Array.from({ length: lineCount }, (_, index) => html`
          <div class="row" data-receive-line>
            <select class="input" data-receive-product aria-label="Producto ${index + 1}">${options}</select>
            <input class="input" data-receive-qty type="number" step="0.01" min="0.01" placeholder="Cantidad" required>
            <input class="input" data-receive-total type="number" step="0.01" min="0" placeholder="Total pagado (opcional)">
            ${lineCount > 1 ? html`<button class="ghost danger" data-remove-receive-line type="button" aria-label="Quitar producto">Quitar</button>` : null}
          </div>
        `)}`
      );
    };

    const render = (): void => {
      const branchId = ctx.branches.operationalId();
      branchEl.textContent = `Sucursal: ${ctx.branches.name(branchId)}`;

      const suppliers = ctx.repos.suppliers.list();
      setHtml(
        supplierSelect,
        html`<option value="">Entrada de inventario</option>${suppliers.map((s) => html`<option value="${s.id}">${s.name}</option>`)}`
      );

      const purchases = ctx.repos.purchases
        .list()
        .filter((purchase) => purchase.branch_id === branchId)
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
                  <p class="muted">${purchase.supplier} | ${fmtMoneyPesos(purchase.total)} | ${fmtDateTime(purchase.created_at)}</p>
                </div>
              `
            )}`
          : html`<p class="muted">Sin entradas registradas. Aquí verás la mercancía que recibas.</p>`
      );
      renderLines();
    };

    addLineButton.addEventListener("click", () => {
      lineCount += 1;
      renderLines();
    });
    linesEl.addEventListener("click", (event) => {
      if ((event.target as HTMLElement).closest("[data-remove-receive-line]")) {
        lineCount = Math.max(1, lineCount - 1);
        renderLines();
      }
    });

    form.addEventListener("submit", (event) => {
      event.preventDefault();
      const supplier = ctx.repos.suppliers.byId(supplierSelect.value);
      const items = [...linesEl.querySelectorAll<HTMLElement>("[data-receive-line]")].map((line) => ({
        productId: line.querySelector<HTMLSelectElement>("[data-receive-product]")?.value ?? "",
        qty: Number(line.querySelector<HTMLInputElement>("[data-receive-qty]")?.value || 0),
        totalPaid: Number(line.querySelector<HTMLInputElement>("[data-receive-total]")?.value || 0)
      }));
      if (items.some((item) => !item.productId || !Number.isFinite(item.qty) || item.qty <= 0 || !Number.isFinite(item.totalPaid) || item.totalPaid < 0)) {
        ctx.toast("Revisa producto y cantidades de todas las líneas");
        return;
      }
      const result = ctx.inventory.receiveStockMany(items, supplier?.name ?? "");
      if (!result.ok) {
        ctx.toast(result.error);
        return;
      }
      form.reset();
      lineCount = 1;
      ctx.toast(`${result.count} productos recibidos: +${fmtQty(result.qty)}`);
      render();
    });

    ctx.store.watch(
      (s) => [s.products, s.purchases, s.suppliers, s.branches, s.currentBranchId] as const,
      render
    );
    render();
  }
};
