import { html, type SafeHtml } from "../../core/html";
import { fmtMoney, lineTotalCents, toCents } from "../../core/money";
import { PAYMENT_LABELS, REFUND_LABELS, type Sale, type SaleReturn } from "../../core/types";
import { itemLabel, returnFolio, returnTotalCents, saleFolio, saleTotalCents } from "../../domain/ticket";
import type { AppContext } from "../context";
import { dateLabel, infoFor, returnInfoFor, returnItemLabel } from "./info";

/** Ticket con aspecto de comprobante impreso. */
export function ticketMarkup(ctx: AppContext, sale: Sale): SafeHtml {
  const info = infoFor(ctx, sale);
  return html`
    <div class="ticket" role="document" aria-label="Ticket de venta">
      <div class="ticket-head">
        ${info.logo ? html`<img class="ticket-logo" src="${info.logo}" alt="">` : html``}
        <strong class="ticket-store">${info.store}</strong>
        ${info.branch ? html`<span>${info.branch}</span>` : html``}
      </div>
      <div class="ticket-meta">
        <span>Folio <b>${saleFolio(sale)}</b></span>
        <span>${dateLabel(sale.created_at)}</span>
        ${sale.cashier ? html`<span>Atendió: ${sale.cashier}</span>` : html``}
        ${info.customer ? html`<span>Cliente: ${info.customer}</span>` : html``}
      </div>
      <div class="ticket-items">
        ${sale.items.map(
          (item) => html`
            <div class="ticket-item">
              <span class="ticket-item-name">${item.name}</span>
              <span class="ticket-item-qty">${itemLabel(item)} × ${fmtMoney(toCents(item.price))}</span>
              <strong>${fmtMoney(lineTotalCents(item.qty, item.price))}</strong>
            </div>
          `
        )}
      </div>
      <div class="ticket-total"><span>TOTAL</span><strong>${fmtMoney(saleTotalCents(sale))}</strong></div>
      <div class="ticket-pay">
        <div><span>Pago</span><span>${PAYMENT_LABELS[sale.payment]}</span></div>
        ${sale.cash_received
          ? html`<div><span>Pagó con</span><span>${fmtMoney(toCents(sale.cash_received))}</span></div>
              <div class="ticket-change"><span>Cambio</span><span>${fmtMoney(toCents(sale.change ?? 0))}</span></div>`
          : html``}
      </div>
      <p class="ticket-foot">¡Gracias por su compra!</p>
    </div>
  `;
}

/** Nota de devolución con el mismo aspecto del ticket. */
export function returnNoteMarkup(ctx: AppContext, ret: SaleReturn): SafeHtml {
  const info = returnInfoFor(ctx, ret);
  return html`
    <div class="ticket" role="document" aria-label="Nota de devolución">
      <div class="ticket-head">
        ${info.logo ? html`<img class="ticket-logo" src="${info.logo}" alt="">` : html``}
        <strong class="ticket-store">${info.store}</strong>
        ${info.branch ? html`<span>${info.branch}</span>` : html``}
        <span class="ticket-headline">Nota de devolución</span>
      </div>
      <div class="ticket-meta">
        <span>Folio <b>${returnFolio(ret)}</b></span>
        ${ret.folio ? html`<span>Venta <b>${ret.folio}</b></span>` : html``}
        <span>${dateLabel(ret.created_at)}</span>
        ${ret.cashier ? html`<span>Atendió: ${ret.cashier}</span>` : html``}
        ${info.customer ? html`<span>Cliente: ${info.customer}</span>` : html``}
      </div>
      <div class="ticket-items">
        ${ret.items.map(
          (item) => html`
            <div class="ticket-item">
              <span class="ticket-item-name">${item.name}</span>
              <span class="ticket-item-qty">${returnItemLabel(item)}</span>
              <strong>${fmtMoney(lineTotalCents(item.qty, item.price))}</strong>
            </div>
          `
        )}
      </div>
      <div class="ticket-total"><span>TOTAL DEVUELTO</span><strong>${fmtMoney(returnTotalCents(ret))}</strong></div>
      <div class="ticket-pay">
        <div><span>Reembolso</span><span>${REFUND_LABELS[ret.payment]}</span></div>
        ${ret.reason ? html`<div><span>Motivo</span><span>${ret.reason}</span></div>` : html``}
      </div>
      <p class="ticket-foot">La mercancía regresó al inventario</p>
    </div>
  `;
}
