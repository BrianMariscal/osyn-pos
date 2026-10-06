/**
 * Ticket de venta: vista en pantalla, imagen PNG del comprobante y envío por
 * WhatsApp (opcional), siempre como imagen: en celular con el menú de
 * compartir del sistema; en computadora se copia la imagen y se abre el chat.
 */
import { html, type SafeHtml } from "../core/html";
import { fmtMoney, lineTotalCents, toCents } from "../core/money";
import { PAYMENT_LABELS, type Sale } from "../core/types";
import { itemLabel, saleFolio, saleTotalCents } from "../domain/ticket";
import { openModal } from "./components/modal";
import { downloadBlob } from "./tabs/download";
import type { AppContext } from "./context";

interface TicketInfo {
  store: string;
  branch: string;
  logo: string;
  customer: string;
}

function infoFor(ctx: AppContext, sale: Sale): TicketInfo {
  const settings = ctx.store.getState().settings;
  return {
    store: settings.storeName || "Mi tienda",
    branch: ctx.branches.isMultiBranch() ? ctx.branches.name(sale.branch_id) : "",
    logo: settings.logo,
    customer: sale.customer_id ? ctx.repos.customers.byId(sale.customer_id)?.name ?? "" : ""
  };
}

function dateLabel(iso: string): string {
  return new Date(iso).toLocaleString("es-MX", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
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

function loadImage(src: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    if (!src) return resolve(null);
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

/** Imagen PNG del ticket (ancho de ticket de 80 mm, a doble resolución). */
export async function ticketImage(ctx: AppContext, sale: Sale): Promise<Blob> {
  const info = infoFor(ctx, sale);
  const logo = await loadImage(info.logo);
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
  wrap(info.store, 22, 800, W - pad * 2).forEach((line) => text(line, 22, 800, "center"));
  if (info.branch) text(info.branch, 14, 400, "center", "#546374");
  gap(6);
  dashed();
  row("Folio", saleFolio(sale), 14, 600);
  row("Fecha", dateLabel(sale.created_at), 14);
  if (sale.cashier) row("Atendió", sale.cashier, 14);
  if (info.customer) row("Cliente", info.customer, 14);
  dashed();
  for (const item of sale.items) {
    wrap(item.name, 16, 700, W - pad * 2).forEach((line) => text(line, 16, 700));
    row(`${itemLabel(item)} × ${fmtMoney(toCents(item.price))}`, fmtMoney(lineTotalCents(item.qty, item.price)), 14, 400, "#3d4a57");
    gap(2);
  }
  dashed();
  row("TOTAL", fmtMoney(saleTotalCents(sale)), 24, 800);
  gap(4);
  row("Pago", PAYMENT_LABELS[sale.payment], 15);
  if (sale.cash_received) {
    row("Pagó con", fmtMoney(toCents(sale.cash_received)), 15);
    row("Cambio", fmtMoney(toCents(sale.change ?? 0)), 17, 800, "#2e8a57");
  }
  dashed();
  gap(4);
  text("¡Gracias por su compra!", 16, 700, "center");
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
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("No se pudo crear la imagen del ticket"))), "image/png")
  );
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
 * Envía el ticket como IMAGEN. Se llama directo en el toque (sin esperas):
 * iPhone/Android solo permiten abrir el menú de compartir dentro del gesto,
 * por eso la imagen se genera antes, al abrir la ventana del ticket.
 */
function sendTicket(ctx: AppContext, sale: Sale, blob: Blob, phone: string): void {
  const file = new File([blob], `ticket-${saleFolio(sale)}.png`, { type: "image/png" });
  if (canShareImages()) {
    // Solo la imagen: con texto adjunto algunas versiones de WhatsApp mandan solo el texto
    navigator.share({ files: [file] }).catch((error: unknown) => {
      if (error instanceof DOMException && error.name === "AbortError") return; // canceló
      shareFromDesktop(ctx, file, phone);
    });
    return;
  }
  shareFromDesktop(ctx, file, phone);
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
  const mobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
  if (mobile) {
    window.location.href = number ? `whatsapp://send?phone=${number}` : "whatsapp://";
    return;
  }
  window.open(number ? `https://web.whatsapp.com/send?phone=${number}` : "https://web.whatsapp.com/", "whatsapp-web");
}

function shareFromDesktop(ctx: AppContext, file: File, phone: string): void {
  const copy =
    typeof ClipboardItem !== "undefined" && navigator.clipboard?.write
      ? navigator.clipboard.write([new ClipboardItem({ "image/png": file })])
      : Promise.reject(new Error("sin portapapeles"));
  openWhatsAppChat(waNumber(phone));
  copy
    .then(() => ctx.toast("Imagen del ticket copiada: en el chat de WhatsApp pégala con Ctrl+V"))
    .catch(() => {
      downloadBlob(file.name, file);
      ctx.toast("Ticket descargado: en WhatsApp adjunta la imagen (clip › Fotos)");
    });
}

/** Ventana del ticket (al cobrar o desde el historial). Enviarlo es opcional. */
export function openTicket(ctx: AppContext, sale: Sale, options: { justSold?: boolean } = {}): void {
  const shareFiles = canShareImages();
  const customerPhone = sale.customer_id ? ctx.repos.customers.byId(sale.customer_id)?.phone ?? "" : "";
  const internal = sale.payment === "interno";
  openModal({
    title: options.justSold ? (internal ? "Uso interno registrado" : sale.payment === "fiado" ? "Venta fiada registrada" : "Venta registrada") : `Ticket ${saleFolio(sale)}`,
    content: html`
      ${options.justSold && sale.cash_received
        ? html`<div class="change-banner"><span>Cambio a entregar</span><strong>${fmtMoney(toCents(sale.change ?? 0))}</strong></div>`
        : html``}
      ${ticketMarkup(ctx, sale)}
      ${internal
        ? html`<p class="hint">Uso interno: no suma a las ventas.</p>`
        : html`<div class="ticket-send">
            <p class="micro">¿El cliente quiere su ticket?</p>
            ${shareFiles
              ? html``
              : html`<input id="ticketPhone" class="input" type="tel" inputmode="tel" placeholder="WhatsApp del cliente (opcional)" value="${customerPhone}">`}
            <div class="ticket-actions">
              <button class="primary whatsapp-btn" type="button" data-ticket-send>Enviar por WhatsApp</button>
              <button class="ghost" type="button" data-ticket-download>Descargar imagen</button>
            </div>
          </div>`}
    `,
    actions: [{ label: options.justSold ? "Nueva venta" : "Cerrar", kind: options.justSold ? "primary" : "ghost" }],
    onOpen: (root) => {
      // La imagen se prepara desde ahora para compartirla al instante
      let image: Blob | null = null;
      const ready = ticketImage(ctx, sale).then((blob) => (image = blob));
      ready.catch(() => undefined);
      root.querySelector<HTMLElement>("[data-ticket-send]")?.addEventListener("click", () => {
        const phone = root.querySelector<HTMLInputElement>("#ticketPhone")?.value ?? "";
        if (image) {
          sendTicket(ctx, sale, image, phone);
          return;
        }
        ctx.toast("Preparando la imagen del ticket…");
        void ready
          .then((blob) => sendTicket(ctx, sale, blob, phone))
          .catch((error: unknown) => ctx.toast(error instanceof Error ? error.message : "No se pudo crear la imagen"));
      });
      root.querySelector<HTMLElement>("[data-ticket-download]")?.addEventListener("click", () => {
        void ready
          .then((blob) => downloadBlob(`ticket-${saleFolio(sale)}.png`, blob))
          .catch((error: unknown) => ctx.toast(error instanceof Error ? error.message : "No se pudo crear la imagen"));
      });
    }
  });
}
