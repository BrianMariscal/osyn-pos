/**
 * Botón de escáner junto a un buscador: lee el código con la cámara (código de
 * barras o QR de la app) y lo escribe en el buscador como si se hubiera tecleado.
 * Los lectores USB/Bluetooth no lo necesitan: "teclean" el código directo.
 */
import { html } from "../core/html";
import { resolveScannedCode } from "../domain/catalog";
import { iconFor } from "./icons";
import { scanBarcode } from "./scanner";
import type { AppContext } from "./context";

export function scanButtonMarkup(id: string) {
  return html`<button id="${id}" class="primary scan-btn" type="button" title="Escanear código de barras o QR" aria-label="Escanear código">${iconFor("barcode")}<span class="hide-sm">Escanear</span></button>`;
}

/** Escanea y escribe en el buscador; con QR de la app pone el nombre del producto. */
export function wireScanToSearch(ctx: AppContext, button: HTMLElement, input: HTMLInputElement, onDone?: () => void): void {
  button.addEventListener("click", async () => {
    try {
      const code = await scanBarcode();
      if (!code) return;
      const product = resolveScannedCode(ctx.repos.products.list(), code);
      input.value = product?.barcode?.trim() === code.trim() ? code : product?.name ?? code;
      input.dispatchEvent(new Event("input", { bubbles: true }));
      if (!product) ctx.toast("Ese código no está registrado");
      onDone?.();
    } catch (error) {
      ctx.toast(error instanceof Error ? error.message : "No se pudo escanear");
    }
  });
}
