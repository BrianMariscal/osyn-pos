import { html, setHtml, type SafeHtml } from "../../core/html";
import { fmtMoney, fmtMoneyPesos, lineTotalCents, speakPesos, sumCents } from "../../core/money";
import { fmtQty } from "../../core/qty";
import {
  AMOUNT_QUICK_PICKS,
  bulkQuickPicks,
  bulkSubunits,
  defaultBulkSubunit,
  fromBaseQty,
  isBulkUnit,
  qtyFromAmount,
  toBaseQty,
  type BulkSubunit
} from "../../core/units";
import { type CartLine, type CartUnit, type PaymentMethod, type Product, type Supplier } from "../../core/types";
import { resolveScannedCode, searchProducts } from "../../domain/catalog";
import { scanBarcode } from "../scanner";
import { iconFor } from "../icons";
import { speak, vibrate, isVoiceEnabled } from "../voice-recognition";
import { openNewProductModal } from "./inventario";
import { cashChange, quickCashOptions } from "../../domain/ticket";
import { openTicket } from "../ticket";
import { openReturnFlow } from "../return-flow";
import { openModal } from "../components/modal";
import type { TabModule } from "./tab-module";

/** Paso del stepper según la unidad: piezas enteras, medio litro/kilo, 50 gramos. */
function qtyStep(um: string): number {
  if (um === "Pza") return 1;
  if (um === "Gr") return 50;
  return 0.5;
}

const NEW_CUSTOMER = "__nuevo__";
const MAX_RESULTS = 8;

/**
 * Punto de venta. Izquierda: buscar/escanear y los renglones de la venta.
 * Derecha: el cobro (total, forma de pago, recibido y cambio). En celular todo
 * va en una columna y una barra fija abajo muestra el total y "Cobrar".
 */
export const ventaTab: TabModule = {
  id: "venta",
  render(root, ctx) {
    setHtml(
      root,
      html`
        <div class="pos">
          <section class="card pos-main">
            <div class="pos-search">
              <label class="search-field">
                ${iconFor("search")}
                <input id="productSearch" type="search" placeholder="Escribe el producto o escanea el código" autocomplete="off" enterkeyhint="search" aria-label="Buscar producto">
              </label>
              <button id="scanButton" class="primary" type="button" title="Escanear con la cámara">${iconFor("barcode")}<span class="hide-sm">Escanear</span></button>
            </div>
            <p class="kbd-hint"><kbd>F2</kbd> buscar · <kbd>Enter</kbd> agregar · <kbd>3*</kbd> cantidad · <kbd>F4</kbd> recibido · <kbd>F9</kbd> cobrar · <button type="button" class="link-btn" id="showShortcuts"><kbd>F1</kbd> todos los atajos</button></p>
            <div id="searchResults" class="search-results hidden" role="listbox" aria-label="Resultados"></div>

            <div class="pos-lines-head">
              <h2>Productos de la venta <span class="count-badge" data-tone="blue" id="cartBadge"></span></h2>
              <div class="head-actions">
                <button id="returnSale" class="ghost small-btn" type="button" title="Devolver mercancía de una venta">${iconFor("transfer")}<span class="hide-sm">Devolución</span></button>
                <button id="clearCart" class="ghost danger small-btn" type="button">${iconFor("trash")} Vaciar</button>
              </div>
            </div>
            <div class="pos-lines-cols" aria-hidden="true"><span>Producto</span><span>Cantidad</span><span>Importe</span><span></span></div>
            <div id="cartItems" class="pos-lines"></div>
          </section>

          <aside class="card pos-pay" id="payPanel">
            <div class="pay-total">
              <span id="cartTotalLabel">Total a cobrar</span>
              <strong id="cartTotal">$0.00</strong>
            </div>
            <p class="micro">Forma de pago</p>
            <div class="pay-methods" id="payMethods" role="radiogroup" aria-label="Forma de pago">
              <button type="button" role="radio" data-pay="efectivo">${iconFor("wallet")}<span>Efectivo</span></button>
              <button type="button" role="radio" data-pay="transferencia">${iconFor("transfer")}<span>Transferencia</span></button>
              <button type="button" role="radio" data-pay="tarjeta">${iconFor("card")}<span>Tarjeta</span></button>
              <button type="button" role="radio" data-pay="fiado">${iconFor("user")}<span>Fiado</span></button>
              <button type="button" role="radio" data-pay="interno">${iconFor("box")}<span>Uso interno</span></button>
            </div>
            <select id="paymentType" class="hidden" aria-hidden="true" tabindex="-1">
              <option value="efectivo">Efectivo</option>
              <option value="transferencia">Transferencia</option>
              <option value="tarjeta">Tarjeta</option>
              <option value="fiado">Fiado</option>
              <option value="interno">Uso interno</option>
            </select>
            <div id="cashBox" class="cash-box">
              <div class="cash-grid">
                <label class="cash-field">
                  <span>Recibido</span>
                  <input id="cashReceived" class="input cash-input" type="number" step="0.5" min="0" inputmode="decimal" placeholder="$0.00">
                </label>
                <div class="cash-change empty" id="cashChange" aria-live="polite"><span>Cambio</span><strong>—</strong></div>
              </div>
              <div class="cash-quick" id="cashQuick"></div>
            </div>
            <div id="creditBox" class="credit-box hidden">
              <label class="form-field">Cliente
                <select id="creditCustomer" class="input"></select>
              </label>
              <div id="newCustomerFields" class="form hidden">
                <input id="ncName" class="input" placeholder="Nombre del cliente" aria-label="Nombre del cliente" autocomplete="off">
                <input id="ncPhone" class="input" type="tel" placeholder="Teléfono (opcional)" aria-label="Teléfono">
                <input id="ncNotes" class="input" placeholder="Domicilio / referencias (opcional)" aria-label="Domicilio o referencias">
              </div>
              <p class="hint" id="creditHint"></p>
            </div>
            <p id="internalHint" class="hint notice hidden">Se descuenta del inventario pero no suma a las ventas del día. Se registra a costo para el control.</p>
            <button id="completeSale" class="primary pay-button" type="button">Cobrar</button>
          </aside>
        </div>
        <div class="pos-bar" id="posBar">
          <div class="pos-bar-total"><span id="posBarCount"></span><strong id="posBarTotal">$0.00</strong></div>
          <button id="posBarPay" class="pay-button" type="button">Cobrar</button>
        </div>
      `
    );

    const search = root.querySelector<HTMLInputElement>("#productSearch")!;
    const resultsEl = root.querySelector<HTMLElement>("#searchResults")!;
    const items = root.querySelector<HTMLElement>("#cartItems")!;
    const cartBadge = root.querySelector<HTMLElement>("#cartBadge")!;
    const payPanel = root.querySelector<HTMLElement>("#payPanel")!;
    const payMethods = root.querySelector<HTMLElement>("#payMethods")!;
    const totalEl = root.querySelector<HTMLElement>("#cartTotal")!;
    const totalLabelEl = root.querySelector<HTMLElement>("#cartTotalLabel")!;
    const payment = root.querySelector<HTMLSelectElement>("#paymentType")!;
    const creditBox = root.querySelector<HTMLElement>("#creditBox")!;
    const customer = root.querySelector<HTMLSelectElement>("#creditCustomer")!;
    const newCustomerFields = root.querySelector<HTMLElement>("#newCustomerFields")!;
    const ncName = root.querySelector<HTMLInputElement>("#ncName")!;
    const ncPhone = root.querySelector<HTMLInputElement>("#ncPhone")!;
    const ncNotes = root.querySelector<HTMLInputElement>("#ncNotes")!;
    const creditHint = root.querySelector<HTMLElement>("#creditHint")!;
    const internalHint = root.querySelector<HTMLElement>("#internalHint")!;
    const completeButton = root.querySelector<HTMLButtonElement>("#completeSale")!;
    const cashBox = root.querySelector<HTMLElement>("#cashBox")!;
    const cashInput = root.querySelector<HTMLInputElement>("#cashReceived")!;
    const cashQuick = root.querySelector<HTMLElement>("#cashQuick")!;
    const cashChangeEl = root.querySelector<HTMLElement>("#cashChange")!;
    const posBar = root.querySelector<HTMLElement>("#posBar")!;
    const posBarTotal = root.querySelector<HTMLElement>("#posBarTotal")!;
    const posBarCount = root.querySelector<HTMLElement>("#posBarCount")!;
    const posBarPay = root.querySelector<HTMLButtonElement>("#posBarPay")!;
    let searchTimer: ReturnType<typeof setTimeout> | undefined;

    const voiceEnabled = isVoiceEnabled;
    const isMobile = (): boolean => Boolean(window.matchMedia?.("(max-width: 860px)").matches);
    const suppliersById = (): Map<string, Supplier> => new Map(ctx.repos.suppliers.list().map((s) => [s.id, s]));
    const sellable = (): Product[] => ctx.repos.products.list().filter((p) => p.active !== false);
    const matchesFor = (query: string): Product[] => {
      const suppliers = suppliersById();
      return searchProducts(sellable(), query, (p) => (p.supplier_id ? suppliers.get(p.supplier_id) : undefined));
    };

    // ---------------- Captura a granel (peso, volumen e importe) ----------------

    /** Preferencia de captura por producto: subunidad (g/kg, ml/L) y modo importe. */
    const bulkPrefs = new Map<string, { subunitId?: string; amount?: boolean }>();
    const bulkOf = (product: Product): { subunit: BulkSubunit; amount: boolean } => {
      const pref = bulkPrefs.get(product.id);
      const subunits = bulkSubunits(product.um);
      const subunit = subunits.find((s) => s.id === pref?.subunitId) ?? defaultBulkSubunit(product.um);
      return { subunit, amount: Boolean(pref?.amount) };
    };
    const setBulkPref = (productId: string, pref: { subunitId?: string; amount?: boolean }): void => {
      bulkPrefs.set(productId, { ...bulkPrefs.get(productId), ...pref });
    };

    /** Cantidad en unidad base a partir de lo capturado (peso o importe). */
    const bulkBaseFromInput = (product: Product, amount: boolean, subunit: BulkSubunit, raw: string | number): number => {
      const value = Number(String(raw).replace(",", "."));
      if (!Number.isFinite(value) || value <= 0) return 0;
      return amount ? qtyFromAmount(value, ctx.sales.unitPrice({ productId: product.id, qty: 0 })) : toBaseQty(value, subunit);
    };

    /** Texto "= …" que se actualiza en vivo mientras se teclea. */
    const bulkPreviewText = (product: Product, amount: boolean, base: number): string => {
      if (base <= 0) return "= —";
      const price = ctx.sales.unitPrice({ productId: product.id, qty: 0 });
      return amount ? `= ${fmtQty(base)} ${product.um}` : `= ${fmtMoney(lineTotalCents(base, price))}`;
    };

    /** Campo de báscula: cantidad + unidad (g/kg, ml/L) o importe, con atajos. */
    const bulkCaptureHtml = (product: Product, line: CartLine): SafeHtml => {
      const price = ctx.sales.unitPrice(line);
      const { subunit, amount } = bulkOf(product);
      const inputValue = amount
        ? String(Number((lineTotalCents(line.qty, price) / 100).toFixed(2)))
        : String(Number(fromBaseQty(line.qty, subunit).toFixed(4)));
      const preview = amount ? `= ${fmtQty(line.qty)} ${product.um}` : `= ${fmtMoney(lineTotalCents(line.qty, price))}`;
      const chips = amount
        ? AMOUNT_QUICK_PICKS.map((value) => ({ base: qtyFromAmount(value, price), label: `$${value}` }))
        : bulkQuickPicks(product.um).map((pick) => ({ base: pick.qty, label: pick.label }));
      const step = amount ? 0.5 : subunit.id === "g" || subunit.id === "ml" ? 10 : 0.25;
      return html`
        <div class="bulk-capture" data-bulk>
          <div class="bulk-inputs">
            <input class="input" type="number" min="0" step="${step}" value="${inputValue}" data-qty data-bulk-input inputmode="decimal" aria-label="Cantidad de ${product.name}${amount ? " en pesos" : ` en ${subunit.label}`}">
            <button type="button" class="bulk-unit ${amount ? "hidden" : ""}" data-bulk-unit title="Cambiar unidad">${subunit.label}</button>
            <button type="button" class="bulk-mode ${amount ? "active" : ""}" data-bulk-mode aria-pressed="${amount ? "true" : "false"}" title="Capturar por importe (ej. $20 de…)">$</button>
          </div>
          <span class="bulk-preview" data-bulk-preview aria-live="polite">${preview}</span>
          <div class="bulk-chips" data-bulk-chips>
            ${chips.map((chip) => html`<button type="button" class="bulk-chip" data-bulk-chip="${chip.base}">${chip.label}</button>`)}
          </div>
        </div>
      `;
    };

    // ---------------- Búsqueda: escribir o escanear agrega directo ----------------

    /** "3*coca" o "3 x coca": cantidad antes del producto (como en las cajas registradoras). */
    const parseQuery = (raw: string): { qty: number; text: string } => {
      const match = /^\s*(\d+(?:[.,]\d+)?)\s*[*xX]\s*(.*)$/.exec(raw);
      if (!match) return { qty: 1, text: raw.trim() };
      const qty = Number(match[1]!.replace(",", "."));
      return { qty: Number.isFinite(qty) && qty > 0 ? qty : 1, text: match[2]!.trim() };
    };

    let found: Product[] = [];
    let activeIndex = 0;

    /** Lista corta de coincidencias bajo el buscador. Sin texto: no se muestra nada. */
    const renderResults = (): void => {
      const { text, qty } = parseQuery(search.value);
      if (!text) {
        found = [];
        resultsEl.classList.add("hidden");
        setHtml(resultsEl, html``);
        return;
      }
      found = matchesFor(text).slice(0, MAX_RESULTS);
      const total = found.length ? matchesFor(text).length : 0;
      activeIndex = Math.min(activeIndex, Math.max(0, found.length - 1));
      resultsEl.classList.remove("hidden");
      if (!found.length) {
        setHtml(resultsEl, html`<p class="search-empty">Ningún producto coincide con “${text}”.</p>`);
        return;
      }
      setHtml(
        resultsEl,
        html`${found.map((product, index) => {
          const stock = ctx.sales.stockOf(product.id);
          const min = ctx.sales.minStockOf(product.id);
          return html`
            <button class="result-row ${index === activeIndex ? "active" : ""}" type="button" role="option" aria-selected="${index === activeIndex ? "true" : "false"}" data-result="${product.id}" tabindex="-1">
              <span class="row-title"><strong>${product.name}</strong><small class="muted">${product.category || "Sin categoría"}${product.barcode ? ` · ${product.barcode}` : ""}</small></span>
              <span class="stock-pill" data-tone="${stock <= 0 ? "coral" : stock <= min ? "amber" : "green"}">${stock <= 0 ? "Agotado" : `${fmtQty(stock)} ${product.um}`}</span>
              <strong class="row-price">${qty !== 1 ? html`<small class="muted">${fmtQty(qty)} × </small>` : html``}${fmtMoneyPesos(product.price)}</strong>
            </button>
          `;
        })}${total > MAX_RESULTS ? html`<p class="search-more">${total - MAX_RESULTS} más: sigue escribiendo para afinar</p>` : html``}<p class="search-keys">↑ ↓ elegir · Enter agregar · Esc limpiar</p>`
      );
    };

    /** Deja la búsqueda como al inicio: sin texto ni resultados. */
    const resetSearch = (focus = false): void => {
      if (searchTimer) clearTimeout(searchTimer);
      search.value = "";
      activeIndex = 0;
      renderResults();
      if (focus && !isMobile()) search.focus({ preventScroll: true });
    };

    /** Agrega a la venta sin pasos extra y resalta el renglón. */
    const addProduct = (product: Product, qty = 1): void => {
      const result = ctx.sales.addToCart(product.id, qty);
      if (!result.ok) {
        ctx.toast(`${product.name}: ${result.error}`);
        vibrate(120);
        return;
      }
      vibrate(40);
      resetSearch(true);
      requestAnimationFrame(() => {
        const row = items.querySelector<HTMLElement>(`[data-line="${CSS.escape(product.id)}"][data-unit="pza"]`);
        if (!row) return;
        row.classList.remove("flash");
        void row.offsetWidth;
        row.classList.add("flash");
        row.scrollIntoView({ block: "nearest" });
      });
    };

    /** Código leído (cámara, lector USB/Bluetooth o QR): se agrega, o alta rápida si no existe. */
    const handleCode = (code: string, qty = 1): void => {
      const product = resolveScannedCode(ctx.repos.products.list(), code);
      if (product) {
        addProduct(product, qty);
        return;
      }
      const matches = matchesFor(code);
      if (matches.length === 1) {
        addProduct(matches[0]!, qty);
        return;
      }
      if (!matches.length) {
        resetSearch();
        openNewProductModal(ctx, (created) => addProduct(created, qty), { barcode: code });
        return;
      }
      search.value = code;
      activeIndex = 0;
      renderResults();
    };

    search.addEventListener("input", () => {
      if (searchTimer) clearTimeout(searchTimer);
      activeIndex = 0;
      // Al borrar todo se restablece al instante
      if (!parseQuery(search.value).text) {
        renderResults();
        return;
      }
      searchTimer = setTimeout(renderResults, 120);
    });

    // Enter: los lectores de código (USB/Bluetooth) "teclean" el código y Enter.
    // Código exacto → se agrega. Si no, se agrega el resultado marcado (↑ ↓).
    search.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        resetSearch(true);
        return;
      }
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        if (searchTimer) {
          clearTimeout(searchTimer);
          renderResults();
        }
        if (!found.length) return;
        event.preventDefault();
        activeIndex = (activeIndex + (event.key === "ArrowDown" ? 1 : -1) + found.length) % found.length;
        renderResults();
        resultsEl.querySelector(".result-row.active")?.scrollIntoView({ block: "nearest" });
        return;
      }
      if (event.key !== "Enter") return;
      event.preventDefault();
      const { qty, text } = parseQuery(search.value);
      if (!text) return;
      if (searchTimer) clearTimeout(searchTimer);
      const exact = resolveScannedCode(ctx.repos.products.list(), text);
      if (exact) {
        addProduct(exact, qty);
        return;
      }
      const matches = matchesFor(text);
      if (matches.length) addProduct(matches[Math.min(activeIndex, matches.length - 1)]!, qty);
      else if (/^\d{6,}$/.test(text)) handleCode(text, qty);
      else renderResults();
    });

    resultsEl.addEventListener("click", (event) => {
      const row = (event.target as HTMLElement).closest<HTMLElement>("[data-result]");
      const product = row && ctx.repos.products.byId(row.dataset.result!);
      if (product) addProduct(product, parseQuery(search.value).qty);
    });

    // ---------------- Carrito y cobro ----------------

    const cartTotalCents = (): number =>
      sumCents(
        ctx.sales.cart().map((line) => (ctx.repos.products.byId(line.productId) ? lineTotalCents(line.qty, ctx.sales.unitPrice(line)) : 0))
      );

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
          const bulk = isBulkUnit(product.um) && !isBox;
          return html`
            <div class="pos-line ${bulk ? "bulk" : ""}" data-line="${line.productId}" data-unit="${lineUnit}">
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
              ${bulk
                ? bulkCaptureHtml(product, line)
                : html`<div class="qty-stepper" data-step="${step}">
                    <button type="button" data-qty-dec aria-label="Menos cantidad">−</button>
                    <input class="input" type="number" min="0" max="${ctx.sales.availableFor(line.productId, lineUnit)}" step="${step}" value="${line.qty}" data-qty inputmode="decimal" aria-label="Cantidad de ${product.name}${isBox ? " en cajas" : ""}">
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
      const { subunit, amount } = bulkOf(product);
      const base = bulkBaseFromInput(product, amount, subunit, input.value);
      const preview = input.closest<HTMLElement>("[data-bulk]")?.querySelector<HTMLElement>("[data-bulk-preview]");
      if (preview) preview.textContent = bulkPreviewText(product, amount, base);
    });

    items.addEventListener("change", (event) => {
      const input = (event.target as HTMLElement).closest<HTMLInputElement>("[data-qty]");
      const line = input && lineOf(input);
      if (!input || !line) return;
      const product = ctx.repos.products.byId(line.productId);
      if (input.hasAttribute("data-bulk-input") && product) {
        // A granel el campo captura gramos/kilos o el importe, no la unidad base
        const { subunit, amount } = bulkOf(product);
        const base = bulkBaseFromInput(product, amount, subunit, input.value);
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
          const { subunit } = bulkOf(product);
          const next = subunits[(subunits.findIndex((s) => s.id === subunit.id) + 1) % subunits.length]!;
          setBulkPref(product.id, { subunitId: next.id });
          renderCart();
          return;
        }
        if (target.closest("[data-bulk-mode]")) {
          // Alterna entre capturar peso/volumen o importe
          setBulkPref(product.id, { amount: !bulkOf(product).amount });
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
    ctx.store.watch(
      (s) => [s.products, s.product_stocks, s.branches, s.currentBranchId] as const,
      () => {
        renderResults();
        renderCart();
      }
    );

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

    root.querySelector<HTMLButtonElement>("#returnSale")!.addEventListener("click", () => {
      openReturnFlow(ctx);
    });

    root.querySelector<HTMLButtonElement>("#clearCart")!.addEventListener("click", () => {
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
        speak(`Venta registrada por ${speakPesos(sale.total)}.`, voiceEnabled());
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
      resetSearch();
      openTicket(ctx, sale, { justSold: true, onReturn: () => openReturnFlow(ctx, sale) });
      if (sale.change) speak(`Cambio: ${speakPesos(sale.change)}.`, voiceEnabled());
      renderCart();
      window.scrollTo({ top: 0 });
    });

    // ---------------- Atajos de teclado (PC) ----------------

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
    const showShortcuts = (): void => {
      openModal({
        title: "Atajos de teclado",
        content: html`<div class="shortcut-list">${SHORTCUTS.map(([keys, what]) => html`<div><kbd>${keys}</kbd><span>${what}</span></div>`)}</div>`,
        actions: [{ label: "Entendido", kind: "primary" }]
      });
    };
    root.querySelector<HTMLButtonElement>("#showShortcuts")!.addEventListener("click", showShortcuts);

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
      if (key === "F1") return act(showShortcuts);
      if (key === "F2" || (event.ctrlKey && key.toLowerCase() === "b")) return act(() => search.focus());
      if (key === "F3") return act(() => root.querySelector<HTMLButtonElement>("#scanButton")!.click());
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
      if (event.ctrlKey && key === "Delete") return act(() => root.querySelector<HTMLButtonElement>("#clearCart")!.click());
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

    // En "Recibido", Enter cobra
    cashInput.addEventListener("keydown", (event) => {
      if (event.key !== "Enter") return;
      event.preventDefault();
      completeButton.click();
    });

    // Escáner de cámara: código de barras o QR
    root.querySelector<HTMLButtonElement>("#scanButton")!.addEventListener("click", async () => {
      try {
        const code = await scanBarcode();
        if (code) handleCode(code);
      } catch (error) {
        ctx.toast(error instanceof Error ? error.message : "No se pudo escanear");
      }
    });
  }
};
