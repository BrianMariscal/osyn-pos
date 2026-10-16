import { html, setHtml } from "../../../../core/html";
import { fmtMoney, fmtMoneyPesos } from "../../../../core/money";
import { type PaymentMethod } from "../../../../core/types";
import { cashChange, quickCashOptions } from "../../../../domain/ticket";
import { type VentaScene } from "../scene";

export const NEW_CUSTOMER = "__nuevo__";

/** Cobro: formas de pago, efectivo (paga con/cambio) y cliente de fiado. */
export function createPaymentPanel(scene: VentaScene): { renderPaymentState(): void; renderCustomers(): void } {
  const { ctx, ui, cartTotalCents, isMobile } = scene;
  const {
    payMethods,
    payment,
    creditBox,
    customer,
    newCustomerFields,
    ncName,
    creditHint,
    internalHint,
    completeButton,
    cashBox,
    cashInput,
    cashQuick,
    cashChangeEl,
    totalLabelEl,
    posBarPay
  } = ui;

  /** Efectivo: con cuánto paga y cuánto cambio se entrega. */
  const renderCash = (): void => {
    const cash = payment.value === "efectivo";
    const total = cartTotalCents();
    cashBox.classList.toggle("hidden", !cash || total <= 0);
    if (!cash || total <= 0) return;
    setHtml(
      cashQuick,
      html`<button type="button" class="chip-btn" data-cash="exact">Exacto</button>${quickCashOptions(total).map(
        (bill) => html`<button type="button" class="chip-btn" data-cash="${bill}">$${bill}</button>`
      )}`
    );
    const check = cashChange(total, cashInput.value);
    cashChangeEl.className = `cash-change ${check.status}`;
    setHtml(
      cashChangeEl,
      check.status === "ok"
        ? html`<span>Cambio</span><strong>${fmtMoney(check.changeCents)}</strong>`
        : check.status === "short"
          ? html`<span>Faltan</span><strong>${fmtMoney(check.missingCents)}</strong>`
          : html`<span>Cambio</span><strong>—</strong>`
    );
  };

  const renderPaymentState = (): void => {
    const method = payment.value as PaymentMethod;
    const fiado = method === "fiado";
    const internal = method === "interno";
    const total = cartTotalCents();
    creditBox.classList.toggle("hidden", !fiado);
    newCustomerFields.classList.toggle("hidden", !(fiado && customer.value === NEW_CUSTOMER));
    internalHint.classList.toggle("hidden", !internal);
    const label = internal ? "Registrar uso interno" : fiado ? `Fiar ${fmtMoney(total)}` : `Cobrar ${fmtMoney(total)}`;
    completeButton.textContent = label;
    completeButton.disabled = total <= 0;
    posBarPay.textContent = internal ? "Registrar" : fiado ? "Fiar" : "Cobrar";
    totalLabelEl.textContent = internal ? "Total (a precio de venta)" : "Total a cobrar";
    payMethods.querySelectorAll<HTMLElement>("[data-pay]").forEach((button) => {
      const on = button.dataset.pay === method;
      button.classList.toggle("active", on);
      button.setAttribute("aria-checked", String(on));
    });
    renderCash();
    const selected = customer.value && customer.value !== NEW_CUSTOMER ? ctx.repos.customers.byId(customer.value) : undefined;
    creditHint.textContent = selected
      ? `Saldo actual: ${fmtMoneyPesos(selected.balance)}. La venta se suma a su cuenta en Fiado.`
      : fiado
        ? "La venta se envía al módulo de Fiado a nombre de este cliente."
        : "";
  };

  const renderCustomers = (): void => {
    const branchId = ctx.branches.operationalId();
    const selected = customer.value;
    const customers = ctx.repos.customers
      .list()
      .filter((c) => c.branch_id === branchId)
      .sort((a, b) => a.name.localeCompare(b.name));
    setHtml(
      customer,
      html`<option value="">Elige cliente…</option>
        <option value="${NEW_CUSTOMER}" ${selected === NEW_CUSTOMER ? "selected" : null}>+ Cliente nuevo</option>
        ${customers.map(
          (c) => html`<option value="${c.id}" ${c.id === selected ? "selected" : null}>${c.name}${c.balance > 0 ? ` (debe ${fmtMoneyPesos(c.balance)})` : ""}</option>`
        )}`
    );
    renderPaymentState();
  };

  payMethods.addEventListener("click", (event) => {
    const button = (event.target as HTMLElement).closest<HTMLElement>("[data-pay]");
    if (!button) return;
    payment.value = button.dataset.pay!;
    payment.dispatchEvent(new Event("change"));
    if (payment.value === "efectivo" && !isMobile()) cashInput.focus({ preventScroll: true });
  });
  payment.addEventListener("change", renderPaymentState);
  cashInput.addEventListener("input", renderCash);
  cashQuick.addEventListener("click", (event) => {
    const button = (event.target as HTMLElement).closest<HTMLElement>("[data-cash]");
    if (!button) return;
    cashInput.value = button.dataset.cash === "exact" ? (cartTotalCents() / 100).toFixed(2) : button.dataset.cash!;
    renderCash();
  });
  customer.addEventListener("change", () => {
    renderPaymentState();
    if (customer.value === NEW_CUSTOMER) ncName.focus();
  });

  return { renderPaymentState, renderCustomers };
}
