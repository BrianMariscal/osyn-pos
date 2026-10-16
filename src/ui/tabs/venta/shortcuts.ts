import { html } from "../../../core/html";
import { type CartUnit, type PaymentMethod } from "../../../core/types";
import { openModal } from "../../components/modal";
import { qtyStep, type VentaScene } from "./scene";

const SHORTCUTS: Array<[string, string]> = [
  ["F2  o  Ctrl + B", "Ir al buscador"],
  ["Enter", "Agregar el producto (código escaneado o resultado marcado)"],
  ["↑  ↓", "Elegir entre los resultados"],
  ["3*coca  o  3x coca", "Agregar 3 piezas de una vez (también antes de escanear)"],
  ["+  /  −", "Con el buscador vacío: más o menos del último producto"],
  ["Supr", "Con el buscador vacío: quitar el último producto"],
  ["Ctrl + Supr", "Vaciar la venta"],
  ["Esc", "Limpiar la búsqueda"],
  ["F3", "Escanear con la cámara"],
  ["F4", "Escribir con cuánto paga (efectivo)"],
  ["Alt + 1 … 5", "Efectivo, Transferencia, Tarjeta, Fiado, Uso interno"],
  ["F9  o  Ctrl + Enter", "Cobrar"],
  ["Enter (en Recibido)", "Cobrar"],
  ["Enter (en el ticket)", "Nueva venta"],
  ["F1", "Ver esta lista"]
];

/** Atajos de teclado (PC) de la pestaña Venta. */
export function wireVentaShortcuts(scene: VentaScene): void {
  const { ctx, root, ui } = scene;
  const { search, payment, cashInput, completeButton, clearCart, scanButton, showShortcuts } = ui;

  const openHelp = (): void => {
    openModal({
      title: "Atajos de teclado",
      content: html`<div class="shortcut-list">${SHORTCUTS.map(([keys, what]) => html`<div><kbd>${keys}</kbd><span>${what}</span></div>`)}</div>`,
      actions: [{ label: "Entendido", kind: "primary" }]
    });
  };
  showShortcuts.addEventListener("click", openHelp);

  /** Último renglón de la venta (el más reciente). */
  const lastLine = (): { productId: string; unit: CartUnit; qty: number } | null => {
    const cart = ctx.sales.cart();
    const line = cart[cart.length - 1];
    return line ? { productId: line.productId, unit: line.unit === "caja" ? "caja" : "pza", qty: line.qty } : null;
  };
  const PAY_KEYS: PaymentMethod[] = ["efectivo", "transferencia", "tarjeta", "fiado", "interno"];

  document.addEventListener("keydown", (event) => {
    if (!root.classList.contains("active") || document.body.classList.contains("modal-open")) return;
    const inSearch = event.target === search;
    const searchEmpty = !search.value.trim();
    const key = event.key;
    const act = (fn: () => void): void => {
      event.preventDefault();
      fn();
    };
    if (key === "F1") return act(openHelp);
    if (key === "F2" || (event.ctrlKey && key.toLowerCase() === "b")) return act(() => search.focus());
    if (key === "F3") return act(() => scanButton.click());
    if (key === "F4") {
      return act(() => {
        if (payment.value !== "efectivo") {
          payment.value = "efectivo";
          payment.dispatchEvent(new Event("change"));
        }
        cashInput.focus();
        cashInput.select();
      });
    }
    if (key === "F9" || (event.ctrlKey && key === "Enter")) return act(() => completeButton.click());
    if (event.altKey && /^[1-5]$/.test(key)) {
      return act(() => {
        payment.value = PAY_KEYS[Number(key) - 1]!;
        payment.dispatchEvent(new Event("change"));
      });
    }
    if (event.ctrlKey && key === "Delete") return act(() => clearCart.click());
    // + / − / Supr sobre el último producto: solo con el buscador vacío (o fuera de campos)
    const typing = (event.target as HTMLElement).matches?.("input, textarea, select") && !(inSearch && searchEmpty);
    if (typing) return;
    const line = lastLine();
    if (!line) return;
    if (key === "+" || key === "-") {
      return act(() => {
        const product = ctx.repos.products.byId(line.productId);
        const step = line.unit === "caja" ? 1 : qtyStep(product?.um ?? "Pza");
        const result = ctx.sales.setCartQty(line.productId, key === "+" ? line.qty + step : line.qty - step, line.unit);
        if (!result.ok) ctx.toast(result.error);
      });
    }
    if (key === "Delete") return act(() => ctx.sales.removeFromCart(line.productId, line.unit));
  });
}
