import { html, setHtml } from "../../core/html";
import { fmtDateTime, monthInputValue } from "../../core/dates";
import { fmtMoneyPesos, sumCents, toCents, toPesos } from "../../core/money";
import { fmtQty } from "../../core/qty";
import { MERMA_REASONS, type MermaReason } from "../../core/types";
import { iconFor } from "../icons";
import type { TabModule } from "./tab-module";

export const mermasTab: TabModule = {
  id: "mermas",
  render(root, ctx) {
    setHtml(
      root,
      html`
        <div class="split">
          <article class="card">
            <h2>Registrar merma</h2>
            <p class="hint">Producto caducado, dañado o roto: descuenta la existencia de esta sucursal y queda registrado con su impacto a costo.</p>
            <form id="mermaForm" class="form">
              <label class="form-field">Producto
                <select id="mermaProduct" class="input"></select>
              </label>
              <div class="row">
                <label class="form-field">Cantidad
                  <input id="mermaQty" class="input" type="number" step="0.01" min="0.01" required>
                </label>
                <label class="form-field">Motivo
                  <select id="mermaReason" class="input">
                    ${MERMA_REASONS.map((reason) => html`<option>${reason}</option>`)}
                  </select>
                </label>
              </div>
              <label class="form-field">Nota (opcional)
                <input id="mermaNote" class="input" placeholder="Detalle de lo ocurrido">
              </label>
              <button class="ghost danger" type="submit">${iconFor("alert")} Registrar merma</button>
            </form>
            <div class="summary" style="margin-top: var(--sp-4);">
              <div><span>Mermas del mes</span><strong id="mermaMonthTotal">—</strong></div>
              <div><span>Registros del mes</span><strong id="mermaMonthCount">—</strong></div>
            </div>
          </article>

          <article class="card">
            <h2>Historial de mermas</h2>
            <p class="hint" id="mermaBranch"></p>
            <div id="mermaHistory" class="list"></div>
          </article>
        </div>
      `
    );

    const form = root.querySelector<HTMLFormElement>("#mermaForm")!;
    const productSelect = root.querySelector<HTMLSelectElement>("#mermaProduct")!;
    const qtyInput = root.querySelector<HTMLInputElement>("#mermaQty")!;
    const reasonSelect = root.querySelector<HTMLSelectElement>("#mermaReason")!;
    const noteInput = root.querySelector<HTMLInputElement>("#mermaNote")!;
    const historyEl = root.querySelector<HTMLElement>("#mermaHistory")!;
    const branchEl = root.querySelector<HTMLElement>("#mermaBranch")!;
    const monthTotalEl = root.querySelector<HTMLElement>("#mermaMonthTotal")!;
    const monthCountEl = root.querySelector<HTMLElement>("#mermaMonthCount")!;

    const render = (): void => {
      const branchId = ctx.branches.operationalId();
      branchEl.textContent = `Sucursal: ${ctx.branches.name(branchId)}`;

      const products = ctx.repos.products.list().filter((p) => p.active !== false);
      setHtml(productSelect, html`${products.map((p) => html`<option value="${p.id}">${p.name} (${p.um})</option>`)}`);

      const history = ctx.repos.mermas
        .list()
        .filter((merma) => merma.branch_id === branchId)
        .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at));
      setHtml(
        historyEl,
        history.length
          ? html`${history.slice(0, 30).map(
              (merma) => html`
                <div class="list-item item-line">
                  <div>
                    <strong>${merma.product_name}</strong>
                    <p class="muted">${merma.reason}${merma.note ? ` · ${merma.note}` : ""} | ${fmtDateTime(merma.created_at)}</p>
                  </div>
                  <div class="cart-item-total">
                    <strong>${fmtQty(merma.qty)} ${merma.um}</strong>
                    <span class="muted">−${fmtMoneyPesos(merma.cost_impact)}</span>
                  </div>
                </div>
              `
            )}`
          : html`<p class="muted">Sin mermas registradas. Aquí verás el historial.</p>`
      );

      // Impacto del mes en curso
      const month = monthInputValue();
      const inMonth = history.filter((merma) => merma.created_at.slice(0, 7) === month);
      monthTotalEl.textContent = fmtMoneyPesos(toPesos(sumCents(inMonth.map((merma) => toCents(merma.cost_impact)))));
      monthCountEl.textContent = String(inMonth.length);
    };

    form.addEventListener("submit", (event) => {
      event.preventDefault();
      const reason = reasonSelect.value as MermaReason;
      const result = ctx.inventory.registerMerma(productSelect.value, Number(qtyInput.value || 0), reason, noteInput.value.trim());
      if (!result.ok) {
        ctx.toast(result.error);
        return;
      }
      form.reset();
      ctx.toast(`Merma registrada: −${fmtQty(result.merma.qty)} ${result.merma.um}`);
      render();
    });

    ctx.store.watch(
      (s) => [s.products, s.product_stocks, s.mermas, s.branches, s.currentBranchId] as const,
      render
    );
    render();
  }
};
