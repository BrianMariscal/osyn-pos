import { html, setHtml } from "../../../core/html";
import { fmtMoney, fmtMoneyPesos, lineTotalCents, speakPesos } from "../../../core/money";
import { type CartUnit, type PaymentMethod } from "../../../core/types";
import { bulkSubunits, isBulkUnit } from "../../../core/units";
import { cashChange, quickCashOptions } from "../../../domain/ticket";
import { iconFor } from "../../icons";
import { openReturnFlow } from "../../return-flow";
import { openTicket } from "../../ticket";
import { isVoiceEnabled, speak, vibrate } from "../../voice-recognition";
import { qtyStep, type VentaScene } from "./scene";
import type { VentaSearch } from "./search";

const NEW_CUSTOMER = "__nuevo__";

/** Carrito y cobro: renglones, formas de pago, efectivo, fiado y venta completa. */
export function createCart(scene: VentaScene, search: VentaSearch): { renderCart(): void } {
  const { ctx, root, ui, bulk, cartTotalCents, isMobile } = scene;
  const {
    items,
    payPanel,
    payMethods,
    totalEl,
    totalLabelEl,
    payment,
    creditBox,
    customer,
    newCustomerFields,
    ncName,
    ncPhone,
    ncNotes,
    creditHint,
    internalHint,
    completeButton,
    cashBox,
    cashInput,
    cashQuick,
    cashChangeEl,
    posBar,
    posBarTotal,
    posBarCount,
    posBarPay,
    cartBadge,
    returnSale,
    clearCart
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

  const renderCart = (): void => {
    const cart = ctx.sales.cart();
    renderPaymentState();
    root.classList.toggle("pos-empty", cart.length === 0);
    const total = fmtMoney(cartTotalCents());
    totalEl.textContent = total;
    posBarTotal.textContent = total;
    const pieces = cart.length;
    cartBadge.textContent = pieces ? String(pieces) : "";
    posBarCount.textContent = pieces ? `${pieces} ${pieces === 1 ? "producto" : "productos"}` : "";
    posBar.classList.toggle("hidden", !pieces);
    if (!cart.length) {
      setHtml(items, html`<div class="cart-empty-note">${iconFor("cart")}<span>Aún no hay productos en la venta</span><small class="muted">Escribe el nombre o escanea el código para agregar</small></div>`);
      return;
    }
    setHtml(
      items,
      html`${cart.map((line) => {
        const product = ctx.repos.products.byId(line.productId);
        if (!product) return html``;
        const lineUnit: CartUnit = line.unit === "caja" ? "caja" : "pza";
        const isBox = lineUnit === "caja";
        const unit = ctx.sales.unitPrice(line);
        const onOffer = !isBox && unit !== product.price;
        const step = isBox ? 1 : qtyStep(product.um);
        const byPack = ctx.sales.sellsByPack(product.id);
        const bulkLine = isBulkUnit(product.um) && !isBox;
        return html`
          <div class="pos-line ${bulkLine ? "bulk" : ""}" data-line="${line.productId}" data-unit="${lineUnit}">
            <div class="pos-line-info">
              <strong>${product.name}</strong>
              <span class="muted">${isBox
                ? `${fmtMoneyPesos(unit)} por caja de ${product.pack_size ?? 1}`
                : onOffer
                  ? `Oferta ${fmtMoneyPesos(unit)} (antes ${fmtMoneyPesos(product.price)}) por ${product.um}`
                  : `${fmtMoneyPesos(product.price)} por ${product.um}`}</span>
              ${byPack
                ? html`<div class="unit-toggle" role="group" aria-label="Vender por">
                    <button type="button" class="${isBox ? "" : "active"}" data-set-unit="pza" aria-pressed="${isBox ? "false" : "true"}">Pieza</button>
                    <button type="button" class="${isBox ? "active" : ""}" data-set-unit="caja" aria-pressed="${isBox ? "true" : "false"}">Caja</button>
                  </div>`
                : html``}
            </div>
            ${bulkLine
              ? bulk.captureHtml(product, line)
              : html`<div class="qty-stepper" data-step="${step}">
                  <button type="button" data-qty-dec aria-label="Menos cantidad">−</button>
                  <input class="input" name="cantidad" type="number" min="0" max="${ctx.sales.availableFor(line.productId, lineUnit)}" step="${step}" value="${line.qty}" data-qty inputmode="decimal" aria-label="Cantidad de ${product.name}${isBox ? " en cajas" : ""}">
                  <button type="button" data-qty-inc aria-label="Más cantidad">+</button>
                </div>`}
            <strong class="pos-line-total">${fmtMoney(lineTotalCents(line.qty, unit))}</strong>
            <button class="icon-btn danger" type="button" data-remove aria-label="Quitar ${product.name}">${iconFor("trash")}</button>
          </div>
        `;
      })}`
    );
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

  /** Renglón del carrito (producto + unidad) al que pertenece un elemento. */
  const lineOf = (el: HTMLElement): { productId: string; unit: CartUnit } | null => {
    const row = el.closest<HTMLElement>("[data-line]");
    if (!row) return null;
    return { productId: row.dataset.line!, unit: row.dataset.unit === "caja" ? "caja" : "pza" };
  };

  // Vista previa en vivo mientras se teclea la captura a granel
  items.addEventListener("input", (event) => {
    const input = (event.target as HTMLElement).closest<HTMLInputElement>("[data-bulk-input]");
    if (!input) return;
    const line = lineOf(input);
    const product = line && ctx.repos.products.byId(line.productId);
    if (!line || !product) return;
    const { subunit, amount } = bulk.of(product);
    const base = bulk.baseFromInput(product, amount, subunit, input.value);
    const preview = input.closest<HTMLElement>("[data-bulk]")?.querySelector<HTMLElement>("[data-bulk-preview]");
    if (preview) preview.textContent = bulk.previewText(product, amount, base);
  });

  items.addEventListener("change", (event) => {
    const input = (event.target as HTMLElement).closest<HTMLInputElement>("[data-qty]");
    const line = input && lineOf(input);
    if (!input || !line) return;
    const product = ctx.repos.products.byId(line.productId);
    if (input.hasAttribute("data-bulk-input") && product) {
      // A granel el campo captura gramos/kilos o el importe, no la unidad base
      const { subunit, amount } = bulk.of(product);
      const base = bulk.baseFromInput(product, amount, subunit, input.value);
      if (base <= 0) {
        ctx.sales.removeFromCart(line.productId, line.unit);
        return;
      }
      const result = ctx.sales.setCartQty(line.productId, base, line.unit);
      if (!result.ok) ctx.toast(result.error);
      return;
    }
    const result = ctx.sales.setCartQty(line.productId, input.value, line.unit);
    if (!result.ok) ctx.toast(result.error);
  });

  items.addEventListener("click", (event) => {
    const target = event.target as HTMLElement;
    const line = lineOf(target);
    if (!line) return;
    if (target.closest("[data-remove]")) {
      ctx.sales.removeFromCart(line.productId, line.unit);
      return;
    }
    const setUnit = target.closest<HTMLElement>("[data-set-unit]");
    if (setUnit) {
      const to: CartUnit = setUnit.dataset.setUnit === "caja" ? "caja" : "pza";
      const result = ctx.sales.setLineUnit(line.productId, line.unit, to);
      if (!result.ok) ctx.toast(result.error);
      return;
    }
    const bulkBox = target.closest<HTMLElement>("[data-bulk]");
    if (bulkBox) {
      const product = ctx.repos.products.byId(line.productId);
      if (!product) return;
      if (target.closest("[data-bulk-unit]")) {
        // Alterna la subunidad: g ↔ kg, ml ↔ L
        const subunits = bulkSubunits(product.um);
        const { subunit } = bulk.of(product);
        const next = subunits[(subunits.findIndex((s) => s.id === subunit.id) + 1) % subunits.length]!;
        bulk.setPref(product.id, { subunitId: next.id });
        renderCart();
        return;
      }
      if (target.closest("[data-bulk-mode]")) {
        // Alterna entre capturar peso/volumen o importe
        bulk.setPref(product.id, { amount: !bulk.of(product).amount });
        renderCart();
        return;
      }
      const chip = target.closest<HTMLElement>("[data-bulk-chip]");
      if (chip) {
        const base = Number(chip.dataset.bulkChip);
        if (base > 0) {
          const result = ctx.sales.setCartQty(product.id, base, "pza");
          if (!result.ok) ctx.toast(result.error);
        }
        return;
      }
      return; // clics dentro de la captura (el input) no son de la escalera
    }
    const inc = target.closest<HTMLElement>("[data-qty-inc]");
    const dec = target.closest<HTMLElement>("[data-qty-dec]");
    if (!inc && !dec) return;
    const product = ctx.repos.products.byId(line.productId);
    if (!product) return;
    const step = line.unit === "caja" ? 1 : qtyStep(product.um);
    const current = ctx.sales.cart().find((l) => l.productId === line.productId && (l.unit === "caja" ? "caja" : "pza") === line.unit)?.qty ?? 0;
    const result = ctx.sales.setCartQty(line.productId, inc ? current + step : current - step, line.unit);
    if (!result.ok) ctx.toast(result.error);
  });

  ctx.store.watch((s) => s.cart, renderCart);
  ctx.store.watch((s) => [s.customers, s.branches, s.currentBranchId] as const, renderCustomers);

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

  return { renderCart };
}
