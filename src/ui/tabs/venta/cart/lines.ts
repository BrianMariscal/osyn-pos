import { html, setHtml } from "../../../../core/html";
import { fmtMoney, fmtMoneyPesos, lineTotalCents } from "../../../../core/money";
import { type CartUnit } from "../../../../core/types";
import { bulkSubunits, isBulkUnit } from "../../../../core/units";
import { iconFor } from "../../../icons";
import { qtyStep, type VentaScene } from "../scene";

/** Renglones del carrito: dibujo, cantidades, unidad pza/caja y captura a granel. */
export function createCartLines(scene: VentaScene, renderPaymentState: () => void): { renderCart(): void } {
  const { ctx, root, ui, bulk, cartTotalCents } = scene;
  const { items, totalEl, posBarTotal, posBarCount, posBar, cartBadge } = ui;

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

  return { renderCart };
}
