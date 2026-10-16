/**
 * Comprobantes: ticket de venta y nota de devolución. Vista en pantalla, imagen
 * PNG del comprobante y envío por WhatsApp (opcional), siempre como imagen: en
 * celular con el menú de compartir del sistema; en computadora se copia la
 * imagen y se abre el chat.
 */
import { html } from "../../core/html";
import { fmtMoney, toCents } from "../../core/money";
import { type Sale, type SaleReturn } from "../../core/types";
import { returnFolio, returnTotalCents, saleFolio } from "../../domain/ticket";
import { openModal, type ModalAction } from "../components/modal";
import type { AppContext } from "../context";
import { returnNoteImage, ticketImage } from "./document";
import { returnNoteMarkup, ticketMarkup } from "./markup";
import { isMobileDevice, sendBlockHtml, wireSend } from "./share";

export { returnNoteDoc, returnNoteImage, ticketImage } from "./document";
export { returnNoteMarkup, ticketMarkup } from "./markup";

/** Ventana del ticket (al cobrar o desde el historial). Enviarlo es opcional. */
export function openTicket(ctx: AppContext, sale: Sale, options: { justSold?: boolean; onReturn?: () => void } = {}): void {
  const mobile = isMobileDevice();
  const customerPhone = sale.customer_id ? ctx.repos.customers.byId(sale.customer_id)?.phone ?? "" : "";
  const internal = sale.payment === "interno";
  const canReturn = Boolean(options.onReturn) && ctx.returns.hasPending(sale);
  const returnedCents = toCents(ctx.returns.returnedTotal(sale.id));
  const actions: ModalAction[] = [
    { label: options.justSold ? "Nueva venta" : "Cerrar", kind: options.justSold ? "primary" : "ghost" },
    ...(canReturn
      ? [
          {
            label: "Devolver",
            kind: "ghost" as const,
            onClick: (close: () => void) => {
              close();
              options.onReturn?.();
            }
          }
        ]
      : [])
  ];
  openModal({
    title: options.justSold ? (internal ? "Uso interno registrado" : sale.payment === "fiado" ? "Venta fiada registrada" : "Venta registrada") : `Ticket ${saleFolio(sale)}`,
    content: html`
      ${options.justSold && sale.cash_received
        ? html`<div class="change-banner"><span>Cambio a entregar</span><strong>${fmtMoney(toCents(sale.change ?? 0))}</strong></div>`
        : html``}
      ${ticketMarkup(ctx, sale)}
      ${returnedCents > 0 ? html`<p class="hint">Este ticket tiene devoluciones por ${fmtMoney(returnedCents)}.</p>` : html``}
      ${internal ? html`<p class="hint">Uso interno: no suma a las ventas.</p>` : sendBlockHtml(mobile, customerPhone, "ticket")}
    `,
    actions,
    // En PC: Enter = "Nueva venta"; al cerrar (como sea) el cursor vuelve al buscador
    initialFocus: options.justSold && !isMobileDevice() ? "[data-modal-action]" : undefined,
    onClose: () => {
      if (options.justSold && !isMobileDevice()) document.getElementById("productSearch")?.focus();
    },
    onOpen: (root) => {
      // La imagen se prepara desde ahora para compartirla al instante
      wireSend(root, ctx, `ticket-${saleFolio(sale)}.png`, ticketImage(ctx, sale));
    }
  });
}

/** Nota de la devolución recién registrada: pantalla, imagen y WhatsApp. */
export function openReturnNote(ctx: AppContext, ret: SaleReturn): void {
  const mobile = isMobileDevice();
  const customerPhone = ret.customer_id ? ctx.repos.customers.byId(ret.customer_id)?.phone ?? "" : "";
  const fileName = `devolucion-${returnFolio(ret)}.png`;
  openModal({
    title: `Devolución ${returnFolio(ret)}`,
    content: html`
      ${ret.payment === "efectivo"
        ? html`<div class="change-banner"><span>Efectivo a entregar</span><strong>${fmtMoney(returnTotalCents(ret))}</strong></div>`
        : html``}
      ${returnNoteMarkup(ctx, ret)}
      ${sendBlockHtml(mobile, customerPhone, "nota de devolución")}
    `,
    actions: [{ label: "Cerrar", kind: "ghost" }],
    onOpen: (root) => {
      wireSend(root, ctx, fileName, returnNoteImage(ctx, ret));
    }
  });
}
