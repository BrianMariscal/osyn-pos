import { html, setHtml } from "../../core/html";
import { fmtMoney, fmtMoneyPesos, lineTotalCents, speakPesos, sumCents } from "../../core/money";
import { fmtQty } from "../../core/qty";
import { type CartUnit, type PaymentMethod, type Product, type Supplier } from "../../core/types";
import { resolveScannedCode, searchProducts, supplierCode } from "../../domain/catalog";
import { scanBarcode } from "../scanner";
import { iconFor } from "../icons";
import { speak, vibrate, isVoiceEnabled } from "../voice-recognition";
import { openNewProductModal } from "./inventario";
import { cashChange, quickCashOptions } from "../../domain/ticket";
import { openTicket } from "../ticket";
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
            <div id="searchResults" class="search-results hidden" role="listbox" aria-label="Resultados"></div>
            <section id="productPreview" class="preview-card hidden" aria-live="polite"></section>

            <div class="pos-lines-head">
              <h2>Productos de la venta <span class="count-badge" data-tone="blue" id="cartBadge"></span></h2>
              <button id="clearCart" class="ghost danger small-btn" type="button">${iconFor("trash")} Vaciar</button>
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
    const previewEl = root.querySelector<HTMLElement>("#productPreview")!;
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

    // ---------------- Resultados de búsqueda ----------------

    /** Lista corta de coincidencias bajo el buscador. Sin texto: no se muestra nada. */
    const renderResults = (): void => {
      const query = search.value.trim();
      if (!query) {
        resultsEl.classList.add("hidden");
        setHtml(resultsEl, html``);
        return;
      }
      const found = matchesFor(query);
      resultsEl.classList.remove("hidden");
      if (!found.length) {
        setHtml(resultsEl, html`<p class="search-empty">Ningún producto coincide con “${query}”.</p>`);
        return;
      }
      setHtml(
        resultsEl,
        html`${found.slice(0, MAX_RESULTS).map((product) => {
          const stock = ctx.sales.stockOf(product.id);
          const min = ctx.sales.minStockOf(product.id);
          return html`
            <button class="result-row" type="button" role="option" data-result="${product.id}">
              <span class="row-title"><strong>${product.name}</strong><small class="muted">${product.category || "Sin categoría"}${product.barcode ? ` · ${product.barcode}` : ""}</small></span>
              <span class="stock-pill" data-tone="${stock <= 0 ? "coral" : stock <= min ? "amber" : "green"}">${stock <= 0 ? "Agotado" : `${fmtQty(stock)} ${product.um}`}</span>
              <strong class="row-price">${fmtMoneyPesos(product.price)}</strong>
            </button>
          `;
        })}${found.length > MAX_RESULTS ? html`<p class="search-more">${found.length - MAX_RESULTS} más: sigue escribiendo para afinar</p>` : html``}`
      );
    };

    /** Deja la búsqueda como al inicio: sin texto, sin resultados y sin vista previa. */
    const resetSearch = (focus = false): void => {
      if (searchTimer) clearTimeout(searchTimer);
      search.value = "";
      renderResults();
      closePreview();
      if (focus && !isMobile()) search.focus({ preventScroll: true });
    };

    // ---------------- Vista previa del producto ----------------

    /**
     * Vista previa: lo escaneado o elegido se muestra primero (precio y
     * existencia) y solo entra a la venta al tocar "Agregar". Así se puede
     * consultar un precio sin tocar la venta.
     */
    interface PreviewItem { productId: string; qty: number; unit: CartUnit }
    let preview: PreviewItem | null = null;

    const closePreview = (): void => {
      preview = null;
      renderPreview();
    };

    const renderPreview = (): void => {
      const product = preview ? ctx.repos.products.byId(preview.productId) : undefined;
      previewEl.classList.toggle("hidden", !preview || !product);
      if (!preview || !product) {
        setHtml(previewEl, html``);
        return;
      }
      const item = preview;
      const isBox = item.unit === "caja";
      const stock = ctx.sales.stockOf(product.id);
      const min = ctx.sales.minStockOf(product.id);
      const supplier = product.supplier_id ? suppliersById().get(product.supplier_id) : undefined;
      const unitPrice = isBox ? product.pack_price ?? 0 : product.price;
      const step = isBox ? 1 : qtyStep(product.um);
      const byPack = ctx.sales.sellsByPack(product.id);
      setHtml(
        previewEl,
        html`
          <div class="preview-main">
            <div class="preview-info">
              <strong class="preview-name">${product.name}</strong>
              <span class="muted">${product.category || "Sin categoría"}${supplier ? ` · ${supplierCode(supplier) || supplier.name}` : ""}</span>
              <span class="stock-pill" data-tone="${stock <= 0 ? "coral" : stock <= min ? "amber" : "green"}">${stock <= 0 ? "Agotado" : `Existencia: ${fmtQty(stock)} ${product.um}`}</span>
            </div>
            <div class="preview-price">
              <strong>${fmtMoneyPesos(unitPrice)}</strong>
              <span class="muted">por ${isBox ? `caja de ${product.pack_size ?? 1}` : product.um}</span>
            </div>
            <button class="icon-btn preview-close" type="button" data-preview-close aria-label="Cerrar">✕</button>
          </div>
          <div class="preview-actions">
            ${byPack
              ? html`<div class="unit-toggle" role="group" aria-label="Vender por">
                  <button type="button" class="${isBox ? "" : "active"}" data-preview-unit="pza">Pieza ${fmtMoneyPesos(product.price)}</button>
                  <button type="button" class="${isBox ? "active" : ""}" data-preview-unit="caja">Caja ${fmtMoneyPesos(product.pack_price ?? 0)}</button>
                </div>`
              : html``}
            <div class="qty-stepper">
              <button type="button" data-preview-dec aria-label="Menos">−</button>
              <input class="input" type="number" min="${step}" step="${step}" value="${item.qty}" data-preview-qty inputmode="decimal" aria-label="Cantidad">
              <button type="button" data-preview-inc aria-label="Más">+</button>
            </div>
            <button class="primary grow preview-add" type="button" data-preview-add ${stock <= 0 ? "disabled" : null}>${iconFor("plus")} Agregar · ${fmtMoney(lineTotalCents(item.qty, unitPrice))}</button>
          </div>
        `
      );
    };

    const previewProduct = (product: Product): void => {
      preview = { productId: product.id, qty: 1, unit: "pza" };
      // Elegido el producto, la búsqueda vuelve a empezar
      if (searchTimer) clearTimeout(searchTimer);
      search.value = "";
      renderResults();
      renderPreview();
      vibrate(25);
      speak(`${product.name}, ${speakPesos(product.price)}.`, voiceEnabled());
      if (isMobile()) previewEl.scrollIntoView({ behavior: "smooth", block: "nearest" });
      else root.querySelector<HTMLButtonElement>("[data-preview-add]")?.focus({ preventScroll: true });
    };

    const addPreview = (): void => {
      if (!preview) return;
      const product = ctx.repos.products.byId(preview.productId);
      const result = ctx.sales.addToCart(preview.productId, preview.qty, undefined, preview.unit);
      if (!result.ok) {
        ctx.toast(`${product?.name ?? "Producto"}: ${result.error}`);
        return;
      }
      vibrate(40);
      ctx.toast(`${product?.name ?? "Producto"} agregado`);
      resetSearch(true);
    };

    previewEl.addEventListener("click", (event) => {
      const target = event.target as HTMLElement;
      if (!preview) return;
      if (target.closest("[data-preview-close]")) {
        resetSearch(true);
        return;
      }
      if (target.closest("[data-preview-add]")) {
        addPreview();
        return;
      }
      const product = ctx.repos.products.byId(preview.productId);
      const unit = target.closest<HTMLElement>("[data-preview-unit]");
      if (unit) {
        preview.unit = unit.dataset.previewUnit === "caja" ? "caja" : "pza";
        preview.qty = 1;
        renderPreview();
        return;
      }
      const step = preview.unit === "caja" ? 1 : qtyStep(product?.um ?? "Pza");
      if (target.closest("[data-preview-inc]")) preview.qty = Math.round((preview.qty + step) * 1000) / 1000;
      else if (target.closest("[data-preview-dec]")) preview.qty = Math.max(step, Math.round((preview.qty - step) * 1000) / 1000);
      else return;
      renderPreview();
    });

    previewEl.addEventListener("change", (event) => {
      const input = (event.target as HTMLElement).closest<HTMLInputElement>("[data-preview-qty]");
      if (!input || !preview) return;
      const qty = Number(input.value);
      if (Number.isFinite(qty) && qty > 0) preview.qty = qty;
      renderPreview();
    });

    // ---------------- Búsqueda y escáner ----------------

    /** Código leído (cámara, lector USB/Bluetooth o QR): producto o alta rápida. */
    const handleCode = (code: string): void => {
      const product = resolveScannedCode(ctx.repos.products.list(), code);
      if (product) {
        previewProduct(product);
        return;
      }
      const matches = matchesFor(code);
      if (matches.length === 1) {
        previewProduct(matches[0]!);
        return;
      }
      if (!matches.length) {
        resetSearch();
        openNewProductModal(ctx, (created) => previewProduct(created), { barcode: code });
        return;
      }
      search.value = code;
      renderResults();
    };

    search.addEventListener("input", () => {
      if (searchTimer) clearTimeout(searchTimer);
      // Al borrar todo se restablece al instante (sin resultados ni vista previa)
      if (!search.value.trim()) {
        resetSearch();
        return;
      }
      searchTimer = setTimeout(renderResults, 120);
    });

    // Enter: los lectores de código (USB/Bluetooth) "teclean" el código y Enter.
    // Código exacto o un solo resultado → vista previa. Con la búsqueda vacía,
    // Enter agrega lo que está en la vista previa. Escape limpia todo.
    search.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        resetSearch(true);
        return;
      }
      if (event.key === "ArrowDown") {
        resultsEl.querySelector<HTMLElement>("[data-result]")?.focus();
        event.preventDefault();
        return;
      }
      if (event.key !== "Enter") return;
      event.preventDefault();
      const value = search.value.trim();
      if (!value) {
        addPreview();
        return;
      }
      if (searchTimer) clearTimeout(searchTimer);
      const exact = resolveScannedCode(ctx.repos.products.list(), value);
      if (exact) {
        previewProduct(exact);
        return;
      }
      const matches = matchesFor(value);
      if (matches.length === 1) previewProduct(matches[0]!);
      else if (!matches.length && /^\d{6,}$/.test(value)) handleCode(value);
      else renderResults();
    });

    resultsEl.addEventListener("click", (event) => {
      const row = (event.target as HTMLElement).closest<HTMLElement>("[data-result]");
      const product = row && ctx.repos.products.byId(row.dataset.result!);
      if (product) previewProduct(product);
    });
    resultsEl.addEventListener("keydown", (event) => {
      const row = (event.target as HTMLElement).closest<HTMLElement>("[data-result]");
      if (!row) return;
      if (event.key === "ArrowDown") (row.nextElementSibling as HTMLElement | null)?.focus();
      else if (event.key === "ArrowUp") ((row.previousElementSibling as HTMLElement | null) ?? search).focus();
      else if (event.key === "Escape") resetSearch(true);
      else return;
      event.preventDefault();
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
          return html`
            <div class="pos-line" data-line="${line.productId}" data-unit="${lineUnit}">
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
              <div class="qty-stepper" data-step="${step}">
                <button type="button" data-qty-dec aria-label="Menos cantidad">−</button>
                <input class="input" type="number" min="0" max="${ctx.sales.availableFor(line.productId, lineUnit)}" step="${step}" value="${line.qty}" data-qty inputmode="decimal" aria-label="Cantidad de ${product.name}${isBox ? " en cajas" : ""}">
                <button type="button" data-qty-inc aria-label="Más cantidad">+</button>
              </div>
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

    items.addEventListener("change", (event) => {
      const input = (event.target as HTMLElement).closest<HTMLInputElement>("[data-qty]");
      const line = input && lineOf(input);
      if (!input || !line) return;
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
        if (preview && !ctx.repos.products.byId(preview.productId)) preview = null;
        renderPreview();
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
      openTicket(ctx, sale, { justSold: true });
      if (sale.change) speak(`Cambio: ${speakPesos(sale.change)}.`, voiceEnabled());
      renderCart();
      window.scrollTo({ top: 0 });
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
