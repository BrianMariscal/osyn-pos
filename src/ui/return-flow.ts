/**
 * Devoluciones: buscar la venta (folio o recientes), elegir renglones y
 * cantidades, y registrar el reembolso. El stock regresa al inventario y la
 * venta original nunca se toca.
 */
import { fmtDateTime } from "../core/dates";
import { html, setHtml } from "../core/html";
import { fmtMoneyPesos, lineTotalCents, toPesos } from "../core/money";
import { fmtQty, roundQty4 } from "../core/qty";
import { PAYMENT_LABELS, REFUND_LABELS, REFUND_METHODS, RETURN_REASONS, type RefundMethod, type Sale } from "../core/types";
import { saleFolio } from "../domain/ticket";
import { openModal } from "./components/modal";
import { openReturnNote } from "./ticket";
import type { AppContext } from "./context";

/** Abre el flujo de devolución: con venta (desde el ticket) o buscándola. */
export function openReturnFlow(ctx: AppContext, presetSale?: Sale): void {
  if (presetSale) {
    if (ctx.returns.hasPending(presetSale)) openReturnForm(ctx, presetSale);
    else ctx.toast("Esa venta ya está devuelta por completo");
    return;
  }
  openReturnSearch(ctx);
}

/** Ventas de la sucursal con algo por devolver, más recientes primero. */
function returnableSales(ctx: AppContext): Sale[] {
  const branchId = ctx.branches.operationalId();
  return ctx.repos.sales
    .list()
    .filter((sale) => !sale.deleted && sale.payment !== "interno" && (!sale.branch_id || sale.branch_id === branchId))
    .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at))
    .filter((sale) => ctx.returns.hasPending(sale));
}

function saleRowHtml(ctx: AppContext, sale: Sale): ReturnType<typeof html> {
  const pending = ctx.returns.pendingLines(sale).filter((line) => line.pending > 0);
  const customer = sale.customer_id ? ctx.repos.customers.byId(sale.customer_id)?.name ?? "" : "";
  return html`
    <div class="list-item item-line">
      <div>
        <strong>${saleFolio(sale)}</strong>
        <p class="muted">${fmtDateTime(sale.created_at)} · ${fmtMoneyPesos(sale.total)} · ${PAYMENT_LABELS[sale.payment]}${customer ? ` · ${customer}` : ""}</p>
        <p class="muted">Por devolver: ${pending.map((line) => `${fmtQty(line.pending)} ${line.item.name}`).join(", ")}</p>
      </div>
      <button class="ghost small-btn" type="button" data-return-sale="${sale.id}">Devolver</button>
    </div>
  `;
}

/** Paso 1: encontrar la venta por folio o entre las recientes. */
function openReturnSearch(ctx: AppContext): void {
  // Con folio escrito se busca en TODAS las ventas por devolver; sin folio
  // solo se listan las recientes.
  const all = returnableSales(ctx);
  const recent = all.slice(0, 40);
  const byId = new Map(ctx.repos.sales.list().map((sale) => [sale.id, sale]));
  openModal({
    title: "Devolución",
    content: html`
      <p class="muted">Busca la venta por su folio o elige una de las recientes.</p>
      <label class="form-field">Folio de la venta
        <input id="returnFolioSearch" class="input" type="search" placeholder="Ej. ${recent[0] ? saleFolio(recent[0]) : "260915-A1B2"}" autocomplete="off">
      </label>
      <div class="list" id="returnSalesList"></div>
      <p class="hint" id="returnSalesEmpty" hidden>No hay ventas que coincidan con productos por devolver.</p>
    `,
    actions: [{ label: "Cerrar", kind: "ghost" }],
    onOpen: (root, close) => {
      const input = root.querySelector<HTMLInputElement>("#returnFolioSearch");
      const list = root.querySelector<HTMLElement>("#returnSalesList");
      const empty = root.querySelector<HTMLElement>("#returnSalesEmpty");
      if (!input || !list || !empty) return;
      const render = (): void => {
        const query = input.value.trim().toUpperCase();
        const matches = (query ? all : recent).filter((sale) => saleFolio(sale).toUpperCase().includes(query));
        setHtml(list, matches.length ? html`${matches.slice(0, 80).map((sale) => saleRowHtml(ctx, sale))}` : html``);
        empty.hidden = matches.length > 0;
      };
      root.addEventListener("click", (event) => {
        const button = (event.target as HTMLElement).closest<HTMLElement>("[data-return-sale]");
        if (!button) return;
        const sale = button.dataset.returnSale ? byId.get(button.dataset.returnSale) : undefined;
        if (!sale) return;
        close();
        openReturnForm(ctx, sale);
      });
      input.addEventListener("input", render);
      render();
    }
  });
}

/** Paso 2: elegir renglones y cantidades, motivo y forma de reembolso. */
function openReturnForm(ctx: AppContext, sale: Sale): void {
  const pending = ctx.returns.pendingLines(sale).filter((line) => line.pending > 0);
  if (!pending.length) {
    ctx.toast("Esa venta ya está devuelta por completo");
    return;
  }
  const refunds = REFUND_METHODS.filter((method) => method !== "fiado" || Boolean(sale.customer_id));
  const defaultPayment: RefundMethod = refunds.includes(sale.payment as RefundMethod) ? (sale.payment as RefundMethod) : "efectivo";
  const byIndex = new Map(pending.map((line) => [line.index, line]));
  const customer = sale.customer_id ? ctx.repos.customers.byId(sale.customer_id) : undefined;
  let modalRoot: HTMLElement | null = null;
  let closeModal: (() => void) | null = null;

  const collect = (root: HTMLElement): Array<{ index: number; qty: number }> => {
    const lines: Array<{ index: number; qty: number }> = [];
    root.querySelectorAll<HTMLElement>("[data-return-line]").forEach((rowEl) => {
      const check = rowEl.querySelector<HTMLInputElement>("[data-return-check]");
      if (!check?.checked) return;
      const index = Number(rowEl.dataset.returnLine);
      const qty = Number(rowEl.querySelector<HTMLInputElement>("[data-return-qty]")?.value ?? "");
      if (!Number.isFinite(index) || !Number.isFinite(qty) || qty <= 0) return;
      lines.push({ index, qty });
    });
    return lines;
  };

  openModal({
    title: `Devolver venta ${saleFolio(sale)}`,
    content: html`
      <p class="muted">Marca lo que regresa y ajusta la cantidad. La mercancía vuelve al inventario.</p>
      <div class="return-items">
        ${pending.map(
          (line) => html`
            <div class="return-item" data-return-line="${line.index}">
              <label class="return-pick">
                <input type="checkbox" data-return-check checked>
                <span>${line.item.name}</span>
              </label>
              <div class="return-qty">
                <input class="input" type="number" min="0" step="any" inputmode="decimal" value="${roundQty4(line.pending)}" data-return-qty aria-label="Cantidad a devolver de ${line.item.name}">
                <span class="muted">${line.item.um} · ${fmtMoneyPesos(line.item.price)} c/u</span>
              </div>
            </div>
          `
        )}
      </div>
      <div class="row">
        <label class="form-field">Motivo
          <select id="returnReason" class="input">
            ${RETURN_REASONS.map((reason) => html`<option value="${reason}">${reason}</option>`)}
          </select>
        </label>
        <label class="form-field">Reembolso
          <select id="returnPayment" class="input">
            ${refunds.map((method) => html`<option value="${method}" ${method === defaultPayment ? "selected" : null}>${REFUND_LABELS[method]}</option>`)}
          </select>
        </label>
      </div>
      <label class="form-field">Nota (opcional)
        <input id="returnNote" class="input" placeholder="Detalle u observaciones">
      </label>
      ${customer
        ? html`<p class="hint">Cliente: ${customer.name} (saldo actual ${fmtMoneyPesos(customer.balance)}). Con "Abono a fiado" el importe baja su saldo.</p>`
        : html``}
      <p class="hint" id="returnTotalHint"></p>
    `,
    actions: [
      { label: "Cancelar", kind: "ghost" },
      {
        label: "Registrar devolución",
        kind: "primary",
        onClick: () => {
          const root = modalRoot;
          if (!root) return;
          const lines = collect(root);
          if (!lines.length) {
            ctx.toast("Elige al menos un producto a devolver");
            return;
          }
          const payment = (root.querySelector<HTMLSelectElement>("#returnPayment")?.value ?? "efectivo") as RefundMethod;
          const reason = root.querySelector<HTMLSelectElement>("#returnReason")?.value ?? "";
          const note = root.querySelector<HTMLInputElement>("#returnNote")?.value ?? "";
          const result = ctx.returns.create({
            saleId: sale.id,
            lines,
            payment,
            reason,
            note,
            cashier: ctx.auth.displayName() || undefined
          });
          if (!result.ok) {
            ctx.toast(result.error);
            return;
          }
          closeModal?.();
          ctx.toast(`Devolución registrada: ${fmtMoneyPesos(result.ret.total)}`);
          if (result.warning) ctx.toast(result.warning);
          openReturnNote(ctx, result.ret);
        }
      }
    ],
    onOpen: (root, close) => {
      modalRoot = root;
      closeModal = close;
      const hint = root.querySelector<HTMLElement>("#returnTotalHint");
      const recompute = (): void => {
        if (!hint) return;
        const lines = collect(root);
        const cents = lines.reduce((sum, line) => {
          const target = byIndex.get(line.index);
          return sum + (target ? lineTotalCents(line.qty, target.item.price) : 0);
        }, 0);
        const count = lines.reduce((sum, line) => sum + (byIndex.has(line.index) ? 1 : 0), 0);
        hint.textContent = count
          ? `Se devolverán ${count} producto${count === 1 ? "" : "s"} · Total: ${fmtMoneyPesos(toPesos(cents))}`
          : "Marca al menos un producto.";
      };
      root.addEventListener("input", recompute);
      root.addEventListener("change", recompute);
      recompute();
    }
  });
}
