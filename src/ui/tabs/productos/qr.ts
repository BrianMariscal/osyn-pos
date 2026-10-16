import { esc, html, safe } from "../../../core/html";
import { fmtMoneyPesos } from "../../../core/money";
import { type Product } from "../../../core/types";
import { productQrPayload } from "../../../domain/catalog";
import { openModal } from "../../components/modal";
import type { AppContext } from "../../context";

/** Etiqueta QR imprimible: sirve para buscar en Venta productos sin código de barras. */
export async function openProductQr(ctx: AppContext, product: Product): Promise<void> {
  const payload = productQrPayload(product);
  let svgMarkup = "";
  try {
    const { BrowserQRCodeSvgWriter } = await import("@zxing/browser");
    const svg = new BrowserQRCodeSvgWriter().write(payload, 220, 220);
    svg.setAttribute("role", "img");
    svg.setAttribute("aria-label", `Código QR de ${product.name}`);
    svgMarkup = new XMLSerializer().serializeToString(svg);
  } catch {
    ctx.toast("No se pudo generar el código QR");
    return;
  }
  const label = html`<div class="qr-label">${safe(svgMarkup)}<strong>${product.name}</strong><span>${fmtMoneyPesos(product.price)}</span></div>`;
  openModal({
    title: `QR de ${product.name}`,
    content: html`
      ${label}
      <p class="hint">Imprímelo y pégalo en el producto o en el anaquel. En Venta, toca "Escanear" y apunta al QR para agregarlo al carrito.</p>
    `,
    actions: [
      { label: "Cerrar", kind: "ghost" },
      {
        label: "Imprimir",
        kind: "primary",
        onClick: () => {
          const doc = `<!doctype html><html lang="es"><head><meta charset="utf-8"><title>QR ${esc(product.name)}</title><style>body{font-family:Arial,sans-serif;display:grid;place-items:center;padding:24px}.qr-label{display:grid;justify-items:center;gap:6px;border:1px dashed #999;padding:16px;border-radius:8px}.qr-label svg{width:220px;height:220px}</style></head><body>${label.__safe}</body></html>`;
          const url = URL.createObjectURL(new Blob([doc], { type: "text/html;charset=utf-8" }));
          const win = window.open(url, "_blank");
          win?.addEventListener("load", () => win.print());
          setTimeout(() => URL.revokeObjectURL(url), 60000);
        }
      }
    ]
  });
}
