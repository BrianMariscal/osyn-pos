import { html, type SafeHtml } from "../../core/html";
import type { AppContext } from "../context";
import { downloadBlob } from "../tabs/download";

export function isMobileDevice(): boolean {
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

/**
 * Computadora (o navegador sin compartir archivos): se copia la imagen al
 * portapapeles y se abre WhatsApp; en el chat basta con pegar (Ctrl+V).
 * Si no se puede copiar, se descarga para adjuntarla.
 */
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
export function sendBlockHtml(mobile: boolean, customerPhone: string, noun: string): SafeHtml {
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
export function wireSend(root: HTMLElement, ctx: AppContext, fileName: string, ready: Promise<Blob>): void {
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
