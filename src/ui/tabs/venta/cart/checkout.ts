import { fmtMoneyPesos, speakPesos } from "../../../../core/money";
import { type PaymentMethod } from "../../../../core/types";
import { openReturnFlow } from "../../../return-flow";
import { openTicket } from "../../../ticket";
import { isVoiceEnabled, speak, vibrate } from "../../../voice-recognition";
import { NEW_CUSTOMER } from "./payment";
import { type VentaScene } from "../scene";
import type { VentaSearch } from "../search";

/** Botones de la venta: devolución, vaciar, cobrar y atajos del teclado. */
export function createCheckout(scene: VentaScene, search: VentaSearch, renderCart: () => void): void {
  const { ctx, ui } = scene;
  const { returnSale, clearCart, posBarPay, completeButton, cashInput, ncName, ncPhone, ncNotes, customer, payment, payPanel, posBar } = ui;

  returnSale.addEventListener("click", () => {
    openReturnFlow(ctx);
  });

  clearCart.addEventListener("click", () => {
    ctx.sales.clearCart();
    cashInput.value = "";
  });

  // Celular: la barra de abajo lleva al cobro
  posBarPay.addEventListener("click", () => {
    payPanel.scrollIntoView({ behavior: "smooth", block: "start" });
  });
  // …y se oculta cuando el botón de cobrar del panel ya está a la vista
  if ("IntersectionObserver" in window) {
    new IntersectionObserver(([entry]) => posBar.classList.toggle("in-view", Boolean(entry?.isIntersecting)), { threshold: 0.6 }).observe(completeButton);
  }

  completeButton.addEventListener("click", () => {
    const method = payment.value as PaymentMethod;
    const isNew = method === "fiado" && customer.value === NEW_CUSTOMER;
    const customerId = method === "fiado" && !isNew ? customer.value || null : null;
    if (isNew && !ncName.value.trim()) {
      ctx.toast("Escribe el nombre del cliente nuevo");
      ncName.focus();
      return;
    }
    const received = method === "efectivo" && cashInput.value.trim() ? Number(cashInput.value) : null;
    const result = ctx.sales.completeSale({
      payment: method,
      customerId,
      newCustomer: isNew ? { name: ncName.value, phone: ncPhone.value, notes: ncNotes.value } : null,
      cashReceived: received,
      cashier: ctx.auth.displayName() || undefined
    });
    if (!result.ok) {
      ctx.toast(result.error);
      return;
    }
    const sale = result.sale;
    if (method === "interno") {
      ctx.toast(`Uso interno registrado (${fmtMoneyPesos(sale.cost)} a costo)`);
    } else {
      ctx.toast(`Venta registrada: ${fmtMoneyPesos(sale.total)}`);
      speak(`Venta registrada por ${speakPesos(sale.total)}.`, isVoiceEnabled());
    }
    vibrate(80);
    if (isNew) {
      ncName.value = "";
      ncPhone.value = "";
      ncNotes.value = "";
      customer.value = sale.customer_id ?? "";
    }
    // Fiado e interno son excepciones: se vuelve a efectivo para la siguiente venta.
    if (method === "interno" || method === "fiado") {
      payment.value = "efectivo";
      customer.value = "";
    }
    cashInput.value = "";
    search.resetSearch();
    openTicket(ctx, sale, { justSold: true, onReturn: () => openReturnFlow(ctx, sale) });
    if (sale.change) speak(`Cambio: ${speakPesos(sale.change)}.`, isVoiceEnabled());
    renderCart();
    window.scrollTo({ top: 0 });
  });

  // En "Recibido", Enter cobra
  cashInput.addEventListener("keydown", (event) => {
    if (event.key !== "Enter") return;
    event.preventDefault();
    completeButton.click();
  });
}
