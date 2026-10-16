/**
 * Comprobantes: ticket de venta y nota de devolución. Vista en pantalla, imagen
 * PNG del comprobante y envío por WhatsApp (opcional), siempre como imagen: en
 * celular con el menú de compartir del sistema; en computadora se copia la
 * imagen y se abre el chat.
 */
import { html, type SafeHtml } from "../core/html";
import { fmtMoney, lineTotalCents, toCents } from "../core/money";
import { fmtQty } from "../core/qty";
import { PAYMENT_LABELS, REFUND_LABELS, type Sale, type SaleReturn, type SaleReturnItem } from "../core/types";
import { itemLabel, returnFolio, returnTotalCents, saleFolio, saleTotalCents } from "../domain/ticket";
import { openModal, type ModalAction } from "./components/modal";
import { downloadBlob } from "./tabs/download";
import type { AppContext } from "./context";

interface DocInfo {
  store: string;
  branch: string;
  logo: string;
  customer: string;
}

function infoFor(ctx: AppContext, sale: Sale): DocInfo {
  const settings = ctx.store.getState().settings;
  return {
    store: settings.storeName || "Mi tienda",
    branch: ctx.branches.isMultiBranch() ? ctx.branches.name(sale.branch_id) : "",
    logo: settings.logo,
    customer: sale.customer_id ? ctx.repos.customers.byId(sale.customer_id)?.name ?? "" : ""
  };
}

function returnInfoFor(ctx: AppContext, ret: SaleReturn): DocInfo {
  const settings = ctx.store.getState().settings;
  const sale = ctx.repos.sales.byId(ret.sale_id);
  return {
    store: settings.storeName || "Mi tienda",
    branch: sale && ctx.branches.isMultiBranch() ? ctx.branches.name(sale.branch_id) : "",
    logo: settings.logo,
    customer: ret.customer_id ? ctx.repos.customers.byId(ret.customer_id)?.name ?? "" : ""
  };
}

function dateLabel(iso: string): string {
  return new Date(iso).toLocaleString("es-MX", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

function returnItemLabel(item: SaleReturnItem): string {
  const qty = item.pack_size
    ? `${fmtQty(item.qty)} ${item.qty === 1 ? "caja" : "cajas"} (${fmtQty(item.qty * item.pack_size)} ${item.um})`
    : `${fmtQty(item.qty)} ${item.um}`;
  return `${qty} × ${fmtMoney(toCents(item.price))}`;
}

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

function loadImage(src: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    if (!src) return resolve(null);
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

interface DocRow {
  label: string;
  value: string;
  size?: number;
  weight?: number;
  color?: string;
}

/** Contenido del comprobante, igual para ticket y nota de devolución. */
interface PrintableDoc {
  info: DocInfo;
  /** Línea extra bajo el nombre de la tienda (p. ej. "Nota de devolución"). */
  headline: string;
  /** Primera fila en negrita (folio). */
  meta: Array<[string, string]>;
  items: Array<{ name: string; detail: string; amount: string }>;
  totalLabel: string;
  total: string;
  rows: DocRow[];
  footer: string;
}

/** Imagen PNG del comprobante (ancho de ticket de 80 mm, a doble resolución). */
async function documentImage(doc: PrintableDoc): Promise<Blob> {
  const logo = await loadImage(doc.info.logo);
  const W = 420;
  const pad = 26;
  const scale = 2;
  const font = (size: number, weight = 400) => `${weight} ${size}px "Segoe UI", system-ui, -apple-system, Roboto, sans-serif`;
  const measure = document.createElement("canvas").getContext("2d")!;

  const wrap = (text: string, size: number, weight: number, width: number): string[] => {
    measure.font = font(size, weight);
    const words = text.split(/\s+/);
    const lines: string[] = [];
    let line = "";
    for (const word of words) {
      const next = line ? `${line} ${word}` : word;
      if (measure.measureText(next).width > width && line) {
        lines.push(line);
        line = word;
      } else line = next;
    }
    if (line) lines.push(line);
    return lines;
  };

  // Primero se calcula el alto, luego se dibuja
  const ops: Array<(c: CanvasRenderingContext2D, y: number) => number> = [];
  const text = (value: string, size: number, weight = 400, align: CanvasTextAlign = "left", color = "#17202a") =>
    ops.push((c, y) => {
      c.font = font(size, weight);
      c.fillStyle = color;
      c.textAlign = align;
      c.fillText(value, align === "center" ? W / 2 : align === "right" ? W - pad : pad, y + size);
      return size + 6;
    });
  const row = (left: string, right: string, size: number, weight = 400, color = "#17202a") =>
    ops.push((c, y) => {
      c.font = font(size, weight);
      c.fillStyle = color;
      c.textAlign = "left";
      c.fillText(left, pad, y + size);
      c.textAlign = "right";
      c.fillText(right, W - pad, y + size);
      return size + 8;
    });
  const gap = (h: number) => ops.push(() => h);
  const dashed = () =>
    ops.push((c, y) => {
      c.strokeStyle = "#9aa5b1";
      c.setLineDash([5, 4]);
      c.beginPath();
      c.moveTo(pad, y + 6);
      c.lineTo(W - pad, y + 6);
      c.stroke();
      c.setLineDash([]);
      return 14;
    });

  if (logo) {
    const maxW = 180;
    const maxH = 80;
    const ratio = Math.min(maxW / logo.naturalWidth, maxH / logo.naturalHeight, 1);
    const w = logo.naturalWidth * ratio;
    const h = logo.naturalHeight * ratio;
    ops.push((c, y) => {
      c.drawImage(logo, (W - w) / 2, y, w, h);
      return h + 10;
    });
  }
  wrap(doc.info.store, 22, 800, W - pad * 2).forEach((line) => text(line, 22, 800, "center"));
  if (doc.info.branch) text(doc.info.branch, 14, 400, "center", "#546374");
  if (doc.headline) {
    gap(4);
    text(doc.headline, 15, 800, "center");
  }
  gap(6);
  dashed();
  doc.meta.forEach(([label, value], index) => row(label, value, 14, index === 0 ? 600 : 400));
  dashed();
  for (const item of doc.items) {
    wrap(item.name, 16, 700, W - pad * 2).forEach((line) => text(line, 16, 700));
    row(item.detail, item.amount, 14, 400, "#3d4a57");
    gap(2);
  }
  dashed();
  row(doc.totalLabel, doc.total, 24, 800);
  gap(4);
  for (const item of doc.rows) row(item.label, item.value, item.size ?? 15, item.weight ?? 400, item.color ?? "#17202a");
  dashed();
  gap(4);
  text(doc.footer, 16, 700, "center");
  gap(10);

  let height = pad;
  const probe = document.createElement("canvas").getContext("2d")!;
  for (const op of ops) height += op(probe, -10_000);
  height += pad;

  const canvas = document.createElement("canvas");
  canvas.width = W * scale;
  canvas.height = Math.ceil(height * scale);
  const c = canvas.getContext("2d")!;
  c.scale(scale, scale);
  c.fillStyle = "#ffffff";
  c.fillRect(0, 0, W, height);
  let y = pad;
  for (const op of ops) y += op(c, y);
  return await new Promise<Blob>((resolve, reject) =>
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("No se pudo crear la imagen del comprobante"))), "image/png")
  );
}

function ticketDoc(ctx: AppContext, sale: Sale): PrintableDoc {
  const info = infoFor(ctx, sale);
  return {
    info,
    headline: "",
    meta: [
      ["Folio", saleFolio(sale)],
      ["Fecha", dateLabel(sale.created_at)],
      ...(sale.cashier ? ([["Atendió", sale.cashier]] as Array<[string, string]>) : []),
      ...(info.customer ? ([["Cliente", info.customer]] as Array<[string, string]>) : [])
    ],
    items: sale.items.map((item) => ({
      name: item.name,
      detail: `${itemLabel(item)} × ${fmtMoney(toCents(item.price))}`,
      amount: fmtMoney(lineTotalCents(item.qty, item.price))
    })),
    totalLabel: "TOTAL",
    total: fmtMoney(saleTotalCents(sale)),
    rows: [
      { label: "Pago", value: PAYMENT_LABELS[sale.payment] },
      ...(sale.cash_received
        ? [
            { label: "Pagó con", value: fmtMoney(toCents(sale.cash_received)) },
            { label: "Cambio", value: fmtMoney(toCents(sale.change ?? 0)), size: 17, weight: 800, color: "#2e8a57" }
          ]
        : [])
    ],
    footer: "¡Gracias por su compra!"
  };
}

export async function ticketImage(ctx: AppContext, sale: Sale): Promise<Blob> {
  return documentImage(ticketDoc(ctx, sale));
}

export function returnNoteDoc(ctx: AppContext, ret: SaleReturn): PrintableDoc {
  const info = returnInfoFor(ctx, ret);
  return {
    info,
    headline: "NOTA DE DEVOLUCIÓN",
    meta: [
      ["Folio", returnFolio(ret)],
      ...(ret.folio ? ([["Venta", ret.folio]] as Array<[string, string]>) : []),
      ["Fecha", dateLabel(ret.created_at)],
      ...(ret.cashier ? ([["Atendió", ret.cashier]] as Array<[string, string]>) : []),
      ...(info.customer ? ([["Cliente", info.customer]] as Array<[string, string]>) : [])
    ],
    items: ret.items.map((item) => ({
      name: item.name,
      detail: returnItemLabel(item),
      amount: fmtMoney(lineTotalCents(item.qty, item.price))
    })),
    totalLabel: "TOTAL DEVUELTO",
    total: fmtMoney(returnTotalCents(ret)),
    rows: [
      { label: "Reembolso", value: REFUND_LABELS[ret.payment] },
      ...(ret.reason ? [{ label: "Motivo", value: ret.reason }] : [])
    ],
    footer: "La mercancía regresó al inventario"
  };
}

export async function returnNoteImage(ctx: AppContext, ret: SaleReturn): Promise<Blob> {
  return documentImage(returnNoteDoc(ctx, ret));
}

function isMobileDevice(): boolean {
  return /Android|iPhone|iPad|iPod/i.test(navigator.userAgent) || (navigator.maxTouchPoints > 1 && /Macintosh/.test(navigator.userAgent));
}

/**
 * Menú de compartir del sistema solo en celular. En computadora (Windows/Mac
 * también "pueden compartir", pero su menú no siempre trae WhatsApp) se pide
 * el número y se abre el chat del cliente con la imagen copiada.
 */
function useShareSheet(): boolean {
  return isMobileDevice() && canShareImages();
}

function canShareImages(): boolean {
  try {
    const probe = new File([new Blob(["x"], { type: "image/png" })], "t.png", { type: "image/png" });
    return Boolean(navigator.canShare?.({ files: [probe] }));
  } catch {
    return false;
  }
}

/** 10 dígitos de México → con lada 52; cualquier otro número se usa tal cual. */
function waNumber(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  return digits.length === 10 ? `52${digits}` : digits;
}

/**
 * Envía un comprobante como IMAGEN. Se llama directo en el toque (sin esperas):
 * iPhone/Android solo permiten abrir el menú de compartir dentro del gesto,
 * por eso la imagen se genera antes, al abrir la ventana del comprobante.
 */
function sendImage(ctx: AppContext, fileName: string, blob: Blob, phone: string): void {
  const file = new File([blob], fileName, { type: "image/png" });
  const digits = phone.replace(/\D/g, "");
  if (digits && digits.length !== 10 && digits.length < 12) {
    ctx.toast("Revisa el número: escribe los 10 dígitos del celular del cliente");
    return;
  }
  // Con número: se abre el chat de ese cliente (cualquier dispositivo)
  if (digits) {
    sendToNumber(ctx, file, waNumber(digits));
    return;
  }
  // Sin número, en celular: menú de compartir (eliges WhatsApp y el contacto)
  if (useShareSheet()) {
    // Solo la imagen: con texto adjunto algunas versiones de WhatsApp mandan solo el texto
    navigator.share({ files: [file] }).catch((error: unknown) => {
      if (error instanceof DOMException && error.name === "AbortError") return; // canceló
      shareFromDesktop(ctx, file, "");
    });
    return;
  }
  shareFromDesktop(ctx, file, "");
}

function copyImage(file: File): Promise<void> {
  return typeof ClipboardItem !== "undefined" && navigator.clipboard?.write
    ? navigator.clipboard.write([new ClipboardItem({ "image/png": file })])
    : Promise.reject(new Error("sin portapapeles"));
}

/** Abre el chat del número y deja la imagen copiada para pegarla. */
function sendToNumber(ctx: AppContext, file: File, number: string): void {
  if (!isMobileDevice()) {
    shareFromDesktop(ctx, file, number);
    return;
  }
  // Celular: primero se copia la imagen (si se abre WhatsApp antes, la copia se pierde)
  copyImage(file)
    .then(() => {
      ctx.toast("Imagen lista: en el chat mantén presionado y elige Pegar");
      openWhatsAppChat(number);
    })
    .catch(() => {
      // Sin portapapeles de imágenes: se comparte la imagen o se descarga
      if (canShareImages()) {
        ctx.toast("Elige WhatsApp y el chat del cliente");
        navigator.share({ files: [file] }).catch(() => undefined);
        return;
      }
      downloadBlob(file.name, file);
      ctx.toast("Imagen guardada: en el chat toca el clip y adjúntala");
      openWhatsAppChat(number);
    });
}

/**
 * Computadora (o navegador sin compartir archivos): se copia la imagen al
 * portapapeles y se abre WhatsApp; en el chat basta con pegar (Ctrl+V).
 * Si no se puede copiar, se descarga para adjuntarla.
 */
/**
 * Abre el chat directo, sin la página intermedia de wa.me. En computadora usa
 * siempre la misma pestaña de WhatsApp Web (WhatsApp Web solo funciona en una
 * pestaña a la vez); en celular abre la app.
 */
function openWhatsAppChat(number: string): void {
  const mobile = isMobileDevice();
  if (mobile) {
    window.location.href = number ? `whatsapp://send?phone=${number}` : "whatsapp://";
    return;
  }
  window.open(number ? `https://web.whatsapp.com/send?phone=${number}` : "https://web.whatsapp.com/", "whatsapp-web");
}

function shareFromDesktop(ctx: AppContext, file: File, phone: string): void {
  const copy = copyImage(file);
  openWhatsAppChat(phone ? waNumber(phone) : "");
  copy
    .then(() => ctx.toast("Imagen copiada: en el chat de WhatsApp pégala con Ctrl+V"))
    .catch(() => {
      downloadBlob(file.name, file);
      ctx.toast("Imagen descargada: en WhatsApp adjúntala (clip › Fotos)");
    });
}

/** Bloque para enviar el comprobante por WhatsApp (número opcional). */
function sendBlockHtml(mobile: boolean, customerPhone: string, noun: string): SafeHtml {
  return html`
    <div class="ticket-send">
      <p class="micro">¿El cliente quiere su ${noun}?</p>
      <label class="form-field">Número de WhatsApp del cliente
        <input id="ticketPhone" class="input" type="tel" inputmode="tel" autocomplete="off" placeholder="10 dígitos, ej. 55 1234 5678" value="${customerPhone}">
      </label>
      <p class="hint">${mobile
        ? "Con número: se abre su chat y la imagen queda copiada (mantén presionado › Pegar). Sin número: eliges el contacto en el menú de compartir."
        : "Se abre su chat en WhatsApp Web y la imagen queda copiada: pégala con Ctrl + V y envía."}</p>
      <div class="ticket-actions">
        <button class="primary whatsapp-btn" type="button" data-ticket-send>Enviar por WhatsApp</button>
        <button class="ghost" type="button" data-ticket-download>Descargar imagen</button>
      </div>
    </div>
  `;
}

/** Conecta "Enviar por WhatsApp" y "Descargar imagen" del bloque de envío. */
function wireSend(root: HTMLElement, ctx: AppContext, fileName: string, ready: Promise<Blob>): void {
  let image: Blob | null = null;
  void ready.then((blob) => (image = blob)).catch(() => undefined);
  root.querySelector<HTMLElement>("[data-ticket-send]")?.addEventListener("click", () => {
    const phone = root.querySelector<HTMLInputElement>("#ticketPhone")?.value ?? "";
    if (image) {
      sendImage(ctx, fileName, image, phone);
      return;
    }
    ctx.toast("Preparando la imagen…");
    void ready
      .then((blob) => sendImage(ctx, fileName, blob, phone))
      .catch((error: unknown) => ctx.toast(error instanceof Error ? error.message : "No se pudo crear la imagen"));
  });
  root.querySelector<HTMLElement>("[data-ticket-download]")?.addEventListener("click", () => {
    void ready
      .then((blob) => downloadBlob(fileName, blob))
      .catch((error: unknown) => ctx.toast(error instanceof Error ? error.message : "No se pudo crear la imagen"));
  });
}

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
