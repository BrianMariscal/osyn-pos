import { html, setHtml } from "../../core/html";
import { fmtMoney, fmtMoneyPesos, lineTotalCents, speakPesos, sumCents } from "../../core/money";
import { fmtQty } from "../../core/qty";
import { PAYMENT_LABELS, type CartUnit, type PaymentMethod, type Product, type Sale, type Supplier } from "../../core/types";
import { lowStockProducts, resolveScannedCode, suggestOffers, supplierCode, topSellers } from "../../domain/catalog";
import { mountCarousels } from "../carousel";
import { scanBarcode } from "../scanner";
import { openModal } from "../components/modal";
import { iconFor } from "../icons";
import { speak, vibrate, isVoiceEnabled } from "../voice-recognition";
import { openNewProductModal } from "./inventario";
import { mountProductFilters, productFiltersMarkup } from "../product-filters";
import type { TabModule } from "./tab-module";

/** Paso del stepper según la unidad: piezas enteras, medio litro/kilo, 50 gramos. */
function qtyStep(um: string): number {
  if (um === "Pza") return 1;
  if (um === "Gr") return 50;
  return 0.5;
}

const NEW_CUSTOMER = "__nuevo__";

export const ventaTab: TabModule = {
  id: "venta",
  render(root, ctx) {
    setHtml(
      root,
      html`
        <div class="split">
          <article class="card">
            <div class="search-row">
              <input id="productSearch" class="input" type="search" placeholder="Buscar producto o código de barras" autocomplete="off" enterkeyhint="search" aria-label="Buscar producto">
              <button id="scanButton" class="ghost" type="button" title="Escanear código de barras o QR">${iconFor("barcode")} <span class="hide-sm">Escanear</span></button>
            </div>
            ${productFiltersMarkup("sale")}
            <section id="productPreview" class="preview-card hidden" aria-live="polite"></section>
            <div id="saleHighlights" class="highlights"></div>
            <div id="catalogBar" class="catalog-bar hidden">
              <span class="hint" id="catalogInfo"></span>
              <button id="closeCatalog" class="ghost" type="button">Ocultar catálogo</button>
            </div>
            <div id="productGrid" class="product-grid"></div>
          </article>
          <article class="card cart-card" id="cartCard">
            <button class="cart-toggle" id="cartToggle" type="button" aria-expanded="false" aria-controls="cartBody">
              <span>Carrito <span id="cartCount" class="muted"></span></span>
              <strong id="cartToggleTotal">$0.00</strong>
            </button>
            <div class="cart-body" id="cartBody">
              <div id="cartItems" class="list cart-items"><p class="muted">Sin productos</p></div>
              <div class="cart-pay">
                <div class="total-row"><span id="cartTotalLabel">Total</span><strong id="cartTotal">$0.00</strong></div>
                <label class="form-field">Forma de pago
                  <select id="paymentType" class="input">
                    <option value="efectivo">Efectivo</option>
                    <option value="transferencia">Transferencia</option>
                    <option value="tarjeta">Tarjeta</option>
                    <option value="fiado">Fiado (a cuenta del cliente)</option>
                    <option value="interno">Venta interna (uso de la tienda)</option>
                  </select>
                </label>
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
                <div class="actions">
                  <button id="completeSale" class="primary grow">Cobrar</button>
                  <button id="clearCart" class="ghost danger">Vaciar</button>
                </div>
              </div>
            </div>
          </article>
        </div>
      `
    );

    const search = root.querySelector<HTMLInputElement>("#productSearch")!;
    const grid = root.querySelector<HTMLElement>("#productGrid")!;
    const highlights = root.querySelector<HTMLElement>("#saleHighlights")!;
    const catalogBar = root.querySelector<HTMLElement>("#catalogBar")!;
    const catalogInfo = root.querySelector<HTMLElement>("#catalogInfo")!;
    /** Catálogo completo abierto a mano (sin buscar ni filtrar). */
    let showAll = false;
    const carousels = mountCarousels(highlights, () => root.classList.contains("active"));
    const items = root.querySelector<HTMLElement>("#cartItems")!;
    const totalEl = root.querySelector<HTMLElement>("#cartTotal")!;
    const totalLabelEl = root.querySelector<HTMLElement>("#cartTotalLabel")!;
    const toggleTotalEl = root.querySelector<HTMLElement>("#cartToggleTotal")!;
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
    const cartCard = root.querySelector<HTMLElement>("#cartCard")!;
    let searchTimer: ReturnType<typeof setTimeout> | undefined;

    const voiceEnabled = isVoiceEnabled;

    const suppliersById = (): Map<string, Supplier> => new Map(ctx.repos.suppliers.list().map((s) => [s.id, s]));

    const filters = mountProductFilters(root, "sale", ctx, () => renderGrid());

    const filteredProducts = (): Product[] =>
      filters.apply(ctx.repos.products.list().filter((p) => p.active !== false), search.value);

    /**
     * La cuadrícula solo aparece al buscar, filtrar por proveedor o abrir el
     * catálogo; por defecto se ven los recuadros con movimiento.
     */
    const catalogMode = (): boolean => showAll || Boolean(search.value.trim()) || filters.active();

    const renderGrid = (): void => {
      const browsing = catalogMode();
      highlights.classList.toggle("hidden", browsing);
      grid.classList.toggle("hidden", !browsing);
      catalogBar.classList.toggle("hidden", !browsing);
      if (!browsing) {
        setHtml(grid, html``);
        return;
      }
      const products = filteredProducts();
      catalogInfo.textContent = `${products.length} ${products.length === 1 ? "producto" : "productos"}`;
      if (!products.length) {
        const empty = !ctx.repos.products.list().length;
        setHtml(grid, html`<p class="muted grid-empty">${empty ? "Agrega productos para vender." : "Ningún producto coincide con la búsqueda."}</p>`);
        return;
      }
      const suppliers = suppliersById();
      setHtml(
        grid,
        html`${products.map((product) => {
          const stock = ctx.sales.stockOf(product.id);
          const min = ctx.sales.minStockOf(product.id);
          const out = stock <= 0;
          const supplier = product.supplier_id ? suppliers.get(product.supplier_id) : undefined;
          return html`<button
            class="product-tile ${stock <= min ? "low" : ""} ${out ? "out" : ""}"
            type="button"
            data-add="${product.id}"
          >
            <strong>${product.name}</strong>
            <span class="tile-cat">${product.category || "Sin categoría"}${supplier ? ` · ${supplierCode(supplier) || supplier.name}` : ""}</span>
            <b>${fmtMoneyPesos(product.price)}</b>
            <span class="tile-stock">${out ? "Agotado" : `Stock: ${fmtQty(stock)} ${product.um}`}</span>
          </button>`;
        })}`
      );
    };

    /** Recuadros: más vendidos, por agotarse y ofertas que arroja el sistema. */
    const renderHighlights = (): void => {
      const products = ctx.repos.products.list();
      const branchId = ctx.branches.operationalId();
      const sales = ctx.repos.sales.list().filter((sale) => sale.branch_id === branchId);
      const stockOf = (id: string): number => ctx.sales.stockOf(id);
      const top = topSellers(products, sales);
      const low = lowStockProducts(products, stockOf, (id) => ctx.sales.minStockOf(id));
      const offers = suggestOffers(products, sales, stockOf);
      carousels.render([
        {
          id: "top",
          title: "Más vendidos",
          subtitle: "Últimos 30 días",
          empty: "Aún no hay ventas en los últimos 30 días.",
          items: top.map(({ product, qty }, index) => ({
            productId: product.id,
            name: product.name,
            price: fmtMoneyPesos(product.price),
            badge: `#${index + 1}`,
            detail: `${fmtQty(qty)} ${product.um} vendidos`,
            // Tocar solo muestra el producto: también se puede consultar uno agotado
            disabled: false
          }))
        },
        {
          id: "low",
          title: "Por agotarse",
          subtitle: "Existencia en o bajo el mínimo",
          empty: "Todo tiene buena existencia.",
          items: low.map(({ product, stock, min }) => ({
            productId: product.id,
            name: product.name,
            price: fmtMoneyPesos(product.price),
            badge: stock <= 0 ? "Agotado" : "Quedan pocos",
            detail: `Quedan ${fmtQty(stock)} ${product.um} · mín ${fmtQty(min)}`,
            disabled: false
          }))
        },
        {
          id: "offers",
          title: "Ofertas sugeridas",
          subtitle: "Sin venta en 30 días o más: tócala para venderla con descuento",
          empty: "Sin ofertas: todo se ha vendido en el último mes.",
          items: offers.map(({ product, idleDays, discountPct, offerPrice }) => ({
            productId: product.id,
            name: product.name,
            price: fmtMoneyPesos(offerPrice),
            was: fmtMoneyPesos(product.price),
            promoPrice: offerPrice,
            badge: `−${discountPct}%`,
            detail: `${idleDays} días sin venta`,
            disabled: false
          }))
        }
      ]);
    };

    const renderPaymentState = (): void => {
      const method = payment.value as PaymentMethod;
      const fiado = method === "fiado";
      const internal = method === "interno";
      creditBox.classList.toggle("hidden", !fiado);
      newCustomerFields.classList.toggle("hidden", !(fiado && customer.value === NEW_CUSTOMER));
      internalHint.classList.toggle("hidden", !internal);
      completeButton.textContent = internal ? "Registrar uso interno" : fiado ? "Fiar" : "Cobrar";
      totalLabelEl.textContent = internal ? "Total (a precio de venta)" : "Total";
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
      cartCard.classList.toggle("cart-empty", cart.length === 0);
      if (!cart.length) cartCard.classList.remove("cart-open");
      const countLabel = root.querySelector<HTMLElement>("#cartCount");
      if (countLabel) countLabel.textContent = cart.length ? `(${cart.length})` : "";
      const totalCents = sumCents(
        cart.map((line) => {
          const product = ctx.repos.products.byId(line.productId);
          return product ? lineTotalCents(line.qty, ctx.sales.unitPrice(line)) : 0;
        })
      );
      const totalText = fmtMoney(totalCents);
      totalEl.textContent = totalText;
      toggleTotalEl.textContent = totalText;
      if (!cart.length) {
        setHtml(items, html`<p class="muted">Sin productos</p>`);
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
          const lineTotal = lineTotalCents(line.qty, unit);
          const step = isBox ? 1 : qtyStep(product.um);
          const byPack = ctx.sales.sellsByPack(product.id);
          return html`
            <div class="list-item cart-item" data-line="${line.productId}" data-unit="${lineUnit}">
              <div class="cart-item-info">
                <strong>${product.name}</strong>
                <p class="muted">${isBox
                  ? html`${fmtMoneyPesos(unit)} por caja de ${product.pack_size ?? 1}`
                  : onOffer
                    ? html`<s>${fmtMoneyPesos(product.price)}</s> <span class="offer-tag">Oferta ${fmtMoneyPesos(unit)}</span> por ${product.um}`
                    : html`${fmtMoneyPesos(product.price)} por ${product.um}`}</p>
                ${byPack
                  ? html`<div class="unit-toggle" role="group" aria-label="Vender por">
                      <button type="button" class="${isBox ? "" : "active"}" data-set-unit="pza" aria-pressed="${isBox ? "false" : "true"}">Pieza ${fmtMoneyPesos(product.price)}</button>
                      <button type="button" class="${isBox ? "active" : ""}" data-set-unit="caja" aria-pressed="${isBox ? "true" : "false"}">Caja ${fmtMoneyPesos(product.pack_price ?? 0)}</button>
                    </div>`
                  : html``}
              </div>
              <div class="qty-stepper" data-step="${step}">
                <button type="button" data-qty-dec aria-label="Menos cantidad">−</button>
                <input class="input" type="number" min="0" max="${ctx.sales.availableFor(line.productId, lineUnit)}" step="${step}" value="${line.qty}" data-qty inputmode="decimal" aria-label="Cantidad de ${product.name}${isBox ? " en cajas" : ""}">
                <button type="button" data-qty-inc aria-label="Más cantidad">+</button>
              </div>
              <div class="cart-item-total">
                <strong>${fmtMoney(lineTotal)}</strong>
                <button class="ghost danger" type="button" data-remove>Quitar</button>
              </div>
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

    /**
     * Vista previa: lo escaneado, buscado o tocado se muestra primero
     * (precio y existencia) y solo entra al carrito al tocar "Agregar". Así se
     * puede consultar un precio sin tocar el carrito.
     */
    interface PreviewItem { productId: string; qty: number; unit: CartUnit; promo?: number }
    const previewEl = root.querySelector<HTMLElement>("#productPreview")!;
    let preview: PreviewItem[] = [];
    let previewMissing: string[] = [];

    const closePreview = (): void => {
      preview = [];
      previewMissing = [];
      renderPreview();
    };

    const renderPreview = (): void => {
      previewEl.classList.toggle("hidden", !preview.length && !previewMissing.length);
      if (!preview.length && !previewMissing.length) {
        setHtml(previewEl, html``);
        return;
      }
      const suppliers = suppliersById();
      const many = preview.length > 1;
      setHtml(
        previewEl,
        html`
          <div class="preview-head">
            <span class="micro">${many ? `${preview.length} productos encontrados` : "Producto"}</span>
            <button class="icon-btn" type="button" data-preview-close aria-label="Cerrar vista previa">✕</button>
          </div>
          ${preview.map((item, index) => {
            const product = ctx.repos.products.byId(item.productId);
            if (!product) return html``;
            const isBox = item.unit === "caja";
            const stock = ctx.sales.stockOf(product.id);
            const min = ctx.sales.minStockOf(product.id);
            const supplier = product.supplier_id ? suppliers.get(product.supplier_id) : undefined;
            const unitPrice = isBox ? product.pack_price ?? 0 : item.promo ?? product.price;
            const step = isBox ? 1 : qtyStep(product.um);
            const byPack = ctx.sales.sellsByPack(product.id);
            const stockTone = stock <= 0 ? "coral" : stock <= min ? "amber" : "green";
            return html`
              <div class="preview-item" data-preview="${index}">
                <div class="preview-main">
                  <div class="preview-info">
                    <strong class="preview-name">${product.name}</strong>
                    <span class="muted">${product.category || "Sin categoría"}${supplier ? ` · ${supplierCode(supplier) || supplier.name}` : ""}${product.barcode ? ` · ${product.barcode}` : ""}</span>
                  </div>
                  <div class="preview-price">
                    ${item.promo && !isBox ? html`<s class="muted">${fmtMoneyPesos(product.price)}</s>` : html``}
                    <strong>${fmtMoneyPesos(unitPrice)}</strong>
                    <span class="muted">por ${isBox ? `caja de ${product.pack_size ?? 1}` : product.um}</span>
                  </div>
                </div>
                <div class="preview-meta">
                  <span class="stock-pill" data-tone="${stockTone}">${stock <= 0 ? "Agotado" : `Existencia: ${fmtQty(stock)} ${product.um}`}</span>
                  ${byPack && !isBox ? html`<span class="muted">Caja de ${product.pack_size}: ${fmtMoneyPesos(product.pack_price ?? 0)}</span>` : html``}
                </div>
                <div class="preview-actions">
                  ${byPack
                    ? html`<div class="unit-toggle" role="group" aria-label="Vender por">
                        <button type="button" class="${isBox ? "" : "active"}" data-preview-unit="pza">Pieza</button>
                        <button type="button" class="${isBox ? "active" : ""}" data-preview-unit="caja">Caja</button>
                      </div>`
                    : html``}
                  <div class="qty-stepper">
                    <button type="button" data-preview-dec aria-label="Menos">−</button>
                    <input class="input" type="number" min="${step}" step="${step}" value="${item.qty}" data-preview-qty inputmode="decimal" aria-label="Cantidad">
                    <button type="button" data-preview-inc aria-label="Más">+</button>
                  </div>
                  ${many
                    ? html`<button class="ghost" type="button" data-preview-remove aria-label="Quitar de la lista">Quitar</button>`
                    : html`<button class="primary grow" type="button" data-preview-add ${stock <= 0 ? "disabled" : null}>${iconFor("cart")} Agregar · ${fmtMoney(lineTotalCents(item.qty, unitPrice))}</button>`}
                </div>
              </div>
            `;
          })}
          ${previewMissing.length ? html`<p class="hint notice">No encontré: ${previewMissing.join(", ")}</p>` : html``}
          ${many ? html`<button class="primary block" type="button" data-preview-add-all>${iconFor("cart")} Agregar todo al carrito</button>` : html``}
        `
      );
    };

    /** Muestra uno o varios productos en la vista previa (reemplaza la anterior). */
    const showPreview = (items: PreviewItem[], missing: string[] = [], announce = false): void => {
      preview = items;
      previewMissing = missing;
      renderPreview();
      vibrate(25);
      if (window.matchMedia?.("(max-width: 860px)").matches) previewEl.scrollIntoView({ behavior: "smooth", block: "nearest" });
      if (announce && items.length === 1) {
        const product = ctx.repos.products.byId(items[0]!.productId);
        if (product) speak(`${product.name}, ${speakPesos(items[0]!.promo ?? product.price)}.`, voiceEnabled());
      }
    };

    const previewProduct = (product: Product, promo?: number): void =>
      showPreview([{ productId: product.id, qty: 1, unit: "pza", ...(promo ? { promo } : {}) }], [], true);

    const addPreviewItem = (item: PreviewItem): boolean => {
      const product = ctx.repos.products.byId(item.productId);
      const result = ctx.sales.addToCart(item.productId, item.qty, item.promo, item.unit);
      if (!result.ok) {
        ctx.toast(`${product?.name ?? "Producto"}: ${result.error}`);
        return false;
      }
      return true;
    };

    const afterAdd = (count: number): void => {
      if (!count) return;
      vibrate(40);
      ctx.toast(count === 1 ? "Agregado al carrito" : `${count} productos agregados al carrito`);
      if (search.value) {
        search.value = "";
        renderGrid();
      }
    };

    previewEl.addEventListener("click", (event) => {
      const target = event.target as HTMLElement;
      if (target.closest("[data-preview-close]")) {
        closePreview();
        return;
      }
      if (target.closest("[data-preview-add-all]")) {
        const remaining = preview.filter((item) => !addPreviewItem(item));
        const added = preview.length - remaining.length;
        preview = remaining;
        previewMissing = remaining.length ? previewMissing : [];
        renderPreview();
        afterAdd(added);
        return;
      }
      const row = target.closest<HTMLElement>("[data-preview]");
      const index = Number(row?.dataset.preview);
      const item = preview[index];
      if (!row || !item) return;
      const product = ctx.repos.products.byId(item.productId);
      if (target.closest("[data-preview-add]")) {
        if (addPreviewItem(item)) {
          closePreview();
          afterAdd(1);
        }
        return;
      }
      if (target.closest("[data-preview-remove]")) {
        preview.splice(index, 1);
        renderPreview();
        return;
      }
      const unit = target.closest<HTMLElement>("[data-preview-unit]");
      if (unit) {
        item.unit = unit.dataset.previewUnit === "caja" ? "caja" : "pza";
        item.qty = 1;
        renderPreview();
        return;
      }
      const step = item.unit === "caja" ? 1 : qtyStep(product?.um ?? "Pza");
      if (target.closest("[data-preview-inc]")) item.qty = Math.round((item.qty + step) * 1000) / 1000;
      else if (target.closest("[data-preview-dec]")) item.qty = Math.max(step, Math.round((item.qty - step) * 1000) / 1000);
      else return;
      renderPreview();
    });

    previewEl.addEventListener("change", (event) => {
      const input = (event.target as HTMLElement).closest<HTMLInputElement>("[data-preview-qty]");
      const item = preview[Number(input?.closest<HTMLElement>("[data-preview]")?.dataset.preview)];
      if (!input || !item) return;
      const qty = Number(input.value);
      if (Number.isFinite(qty) && qty > 0) item.qty = qty;
      renderPreview();
    });

    /** Código leído (cámara, lector USB/Bluetooth o QR): producto o alta rápida. */
    const handleCode = (code: string): void => {
      const product = resolveScannedCode(ctx.repos.products.list(), code);
      if (product) {
        previewProduct(product);
        return;
      }
      // Texto que no es un código (QR con nombre): se usa como búsqueda.
      search.value = code;
      renderGrid();
      const matches = filteredProducts();
      if (matches.length === 1) {
        previewProduct(matches[0]!);
        return;
      }
      if (!matches.length) {
        search.value = "";
        renderGrid();
        openNewProductModal(ctx, (created) => previewProduct(created), { barcode: code });
      }
    };

    search.addEventListener("input", () => {
      if (searchTimer) clearTimeout(searchTimer);
      searchTimer = setTimeout(renderGrid, 180);
    });

    // Enter en la búsqueda: los lectores de código (USB/Bluetooth) "teclean" el
    // código y Enter. Código exacto o un solo resultado → vista previa.
    // Con la búsqueda vacía, Enter agrega lo que está en la vista previa.
    search.addEventListener("keydown", (event) => {
      if (event.key !== "Enter") return;
      event.preventDefault();
      const value = search.value.trim();
      if (!value) {
        if (preview.length === 1 && addPreviewItem(preview[0]!)) {
          closePreview();
          afterAdd(1);
        }
        return;
      }
      if (searchTimer) clearTimeout(searchTimer);
      const exact = resolveScannedCode(ctx.repos.products.list(), value);
      const matches = exact ? [exact] : filteredProducts();
      if (matches.length === 1) {
        previewProduct(matches[0]!);
        // Código escaneado: se limpia para el siguiente; búsqueda escrita se conserva
        if (exact) {
          search.value = "";
          renderGrid();
        }
      } else if (!matches.length && /^\d{6,}$/.test(value)) {
        handleCode(value);
      } else {
        renderGrid();
      }
    });


    grid.addEventListener("click", (event) => {
      const button = (event.target as HTMLElement).closest<HTMLElement>("[data-add]");
      const product = button && ctx.repos.products.byId(button.dataset.add!);
      if (product) previewProduct(product);
    });

    highlights.addEventListener("click", (event) => {
      const target = event.target as HTMLElement;
      if (target.closest("[data-show-catalog]")) {
        showAll = true;
        renderGrid();
        return;
      }
      const button = target.closest<HTMLElement>("[data-add]");
      if (!button) return;
      const promo = button.dataset.promo ? Number(button.dataset.promo) : undefined;
      const product = ctx.repos.products.byId(button.dataset.add!);
      if (product) previewProduct(product, promo);
    });

    root.querySelector<HTMLButtonElement>("#closeCatalog")!.addEventListener("click", () => {
      showAll = false;
      search.value = "";
      filters.clear();
      renderGrid();
    });

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
    ctx.store.watch((s) => s.suppliers, () => {
      filters.refresh();
      renderGrid();
    });
    ctx.store.watch(
      (s) => [s.products, s.product_stocks, s.branches, s.currentBranchId] as const,
      () => {
        filters.refresh();
        renderGrid();
        renderCart();
        if (preview.length) {
          preview = preview.filter((item) => ctx.repos.products.byId(item.productId));
          renderPreview();
        }
      }
    );
    ctx.store.watch((s) => [s.products, s.product_stocks, s.sales, s.branches, s.currentBranchId] as const, renderHighlights);

    payment.addEventListener("change", renderPaymentState);
    customer.addEventListener("change", () => {
      renderPaymentState();
      if (customer.value === NEW_CUSTOMER) ncName.focus();
    });

    root.querySelector<HTMLButtonElement>("#clearCart")!.addEventListener("click", () => ctx.sales.clearCart());

    // En móvil el carrito es un cajón colapsable: el toggle abre/cierra el cuerpo
    // para que la búsqueda y la cuadrícula de productos no queden tapadas.
    root.querySelector<HTMLButtonElement>("#cartToggle")!.addEventListener("click", () => {
      const open = cartCard.classList.toggle("cart-open");
      root.querySelector<HTMLButtonElement>("#cartToggle")!.setAttribute("aria-expanded", String(open));
    });

    completeButton.addEventListener("click", () => {
      const method = payment.value as PaymentMethod;
      const isNew = method === "fiado" && customer.value === NEW_CUSTOMER;
      const customerId = method === "fiado" && !isNew ? customer.value || null : null;
      if (isNew && !ncName.value.trim()) {
        ctx.toast("Escribe el nombre del cliente nuevo");
        ncName.focus();
        return;
      }
      const result = ctx.sales.completeSale({
        payment: method,
        customerId,
        newCustomer: isNew ? { name: ncName.value, phone: ncPhone.value, notes: ncNotes.value } : null
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
      openReceipt(sale);
      renderCart();
    });

    const openReceipt = (sale: Sale): void => {
      const totalCents = sumCents(sale.items.map((item) => lineTotalCents(item.qty, item.price)));
      const customerName = sale.customer_id ? ctx.repos.customers.byId(sale.customer_id)?.name : undefined;
      const internal = sale.payment === "interno";
      openModal({
        title: internal ? "Uso interno registrado" : sale.payment === "fiado" ? "Venta fiada registrada" : "Venta registrada",
        content: html`
          <div class="receipt">
            ${sale.items.map(
              (item) => html`
                <div class="item-line">
                  <span>${item.pack_size
                    ? `${fmtQty(item.qty)} ${item.qty === 1 ? "caja" : "cajas"} (${fmtQty(item.qty * item.pack_size)} ${item.um})`
                    : `${fmtQty(item.qty)} ${item.um}`} · ${item.name}${item.regular_price ? html` <span class="offer-tag">Oferta</span>` : html``}</span>
                  <strong>${fmtMoney(lineTotalCents(item.qty, item.price))}</strong>
                </div>
              `
            )}
            <div class="total-row receipt-total">
              <span>Total</span>
              <strong>${fmtMoney(totalCents)}</strong>
            </div>
            <p class="muted">${PAYMENT_LABELS[sale.payment]}${customerName ? ` · ${customerName}` : ""}</p>
            ${internal ? html`<p class="hint">No suma a las ventas. Valor a costo: ${fmtMoneyPesos(sale.cost)}.</p>` : html``}
            ${sale.payment === "fiado" ? html`<p class="hint">Quedó en la cuenta del cliente en Fiado.</p>` : html``}
          </div>
        `,
        actions: [{ label: "Nueva venta", kind: "primary" }]
      });
    };


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
