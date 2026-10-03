import { html, setHtml } from "../../core/html";
import { fmtMoney, fmtMoneyPesos, lineTotalCents, speakPesos, sumCents } from "../../core/money";
import { fmtQty } from "../../core/qty";
import { PAYMENT_LABELS, type PaymentMethod, type Product, type Sale, type Supplier } from "../../core/types";
import { matchOrdersToProducts } from "../../domain/voice/product-matcher";
import { parseVoiceSale } from "../../domain/voice/voice-parser";
import { lowStockProducts, productMatches, resolveScannedCode, suggestOffers, supplierCode, supplierLabel, topSellers } from "../../domain/catalog";
import { mountCarousels } from "../carousel";
import { parseSaleWithAi, type AiSaleItem } from "../../ai/assistant-client";
import { scanBarcode } from "../scanner";
import { openModal } from "../components/modal";
import { iconFor } from "../icons";
import { listenOnce, speak, speechSupported, vibrate, isVoiceEnabled } from "../voice-recognition";
import { openNewProductModal } from "./inventario";
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
              <input id="productSearch" class="input" type="search" placeholder="Buscar producto, código o proveedor (#3)" autocomplete="off" enterkeyhint="search" aria-label="Buscar producto">
              <button id="scanButton" class="ghost" type="button" title="Escanear código de barras o QR">${iconFor("barcode")} <span class="hide-sm">Escanear</span></button>
            </div>
            <div class="filter-row">
              <select id="supplierFilter" class="input" aria-label="Filtrar por proveedor"></select>
            </div>
            <div class="voice-sale-box">
              <button id="voiceSaleButton" class="primary" type="button">${iconFor("mic")} Hablar venta</button>
              <p id="voiceSaleText" class="hint">Di: "dos cocas, una leche y tres panes".</p>
            </div>
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
    const supplierFilter = root.querySelector<HTMLSelectElement>("#supplierFilter")!;
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
    const voiceButton = root.querySelector<HTMLButtonElement>("#voiceSaleButton")!;
    const voiceText = root.querySelector<HTMLElement>("#voiceSaleText")!;
    const cartCard = root.querySelector<HTMLElement>("#cartCard")!;
    let searchTimer: ReturnType<typeof setTimeout> | undefined;

    const voiceEnabled = isVoiceEnabled;

    // iPhone: sin dictado — se oculta el bloque de venta por voz
    root.querySelector(".voice-sale-box")?.classList.toggle("hidden", !speechSupported());

    const suppliersById = (): Map<string, Supplier> => new Map(ctx.repos.suppliers.list().map((s) => [s.id, s]));

    const filteredProducts = (): Product[] => {
      const q = search.value.trim();
      const supplierId = supplierFilter.value;
      const suppliers = suppliersById();
      return ctx.repos.products
        .list()
        .filter((p) => p.active !== false)
        .filter((p) => !supplierId || (supplierId === "none" ? !p.supplier_id || !suppliers.has(p.supplier_id) : p.supplier_id === supplierId))
        .filter((p) => productMatches(p, q, p.supplier_id ? suppliers.get(p.supplier_id) : undefined))
        .sort((a, b) => a.name.localeCompare(b.name));
    };

    const renderSupplierFilter = (): void => {
      const suppliers = ctx.repos.suppliers.list().sort((a, b) => (a.number ?? 0) - (b.number ?? 0) || a.name.localeCompare(b.name));
      const selected = supplierFilter.value;
      supplierFilter.closest(".filter-row")?.classList.toggle("hidden", !suppliers.length);
      setHtml(
        supplierFilter,
        html`<option value="">Todos los proveedores</option>
          ${suppliers.map((s) => html`<option value="${s.id}" ${s.id === selected ? "selected" : null}>${supplierLabel(s)}</option>`)}
          <option value="none" ${selected === "none" ? "selected" : null}>Sin proveedor</option>`
      );
      if (selected && supplierFilter.value !== selected) supplierFilter.value = "";
    };

    /**
     * La cuadrícula solo aparece al buscar, filtrar por proveedor o abrir el
     * catálogo; por defecto se ven los recuadros con movimiento.
     */
    const catalogMode = (): boolean => showAll || Boolean(search.value.trim()) || Boolean(supplierFilter.value);

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
            ${out ? "disabled" : null}
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
            disabled: stockOf(product.id) <= 0
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
            disabled: stock <= 0
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
          const unit = ctx.sales.unitPrice(line);
          const onOffer = unit !== product.price;
          const lineTotal = lineTotalCents(line.qty, unit);
          const step = qtyStep(product.um);
          return html`
            <div class="list-item cart-item">
              <div class="cart-item-info">
                <strong>${product.name}</strong>
                <p class="muted">${onOffer ? html`<s>${fmtMoneyPesos(product.price)}</s> <span class="offer-tag">Oferta ${fmtMoneyPesos(unit)}</span>` : fmtMoneyPesos(product.price)} por ${product.um}</p>
              </div>
              <div class="qty-stepper" data-step="${step}">
                <button type="button" data-qty-dec="${line.productId}" aria-label="Menos cantidad">−</button>
                <input class="input" type="number" min="0" max="${ctx.sales.stockOf(line.productId)}" step="${step}" value="${line.qty}" data-qty="${line.productId}" inputmode="decimal" aria-label="Cantidad de ${product.name}">
                <button type="button" data-qty-inc="${line.productId}" aria-label="Más cantidad">+</button>
              </div>
              <div class="cart-item-total">
                <strong>${fmtMoney(lineTotal)}</strong>
                <button class="ghost danger" type="button" data-remove="${line.productId}">Quitar</button>
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

    const addProduct = (product: Product): void => {
      const result = ctx.sales.addToCart(product.id);
      if (result.ok) {
        vibrate(40);
        ctx.toast(`${product.name} agregado`);
      } else {
        ctx.toast(result.error);
      }
    };

    /** Código leído (cámara, lector USB/Bluetooth o QR): producto o alta rápida. */
    const handleCode = (code: string): void => {
      const product = resolveScannedCode(ctx.repos.products.list(), code);
      if (product) {
        addProduct(product);
        return;
      }
      // Texto que no es un código (QR con nombre): se usa como búsqueda.
      search.value = code;
      renderGrid();
      const matches = filteredProducts();
      if (matches.length === 1) {
        addProduct(matches[0]!);
        search.value = "";
        renderGrid();
        return;
      }
      if (!matches.length) {
        search.value = "";
        renderGrid();
        openNewProductModal(ctx, (created) => addProduct(created), { barcode: code });
      }
    };

    search.addEventListener("input", () => {
      if (searchTimer) clearTimeout(searchTimer);
      searchTimer = setTimeout(renderGrid, 180);
    });

    // Enter en la búsqueda: los lectores de código (USB/Bluetooth) "teclean" el
    // código y Enter. Código exacto o un solo resultado → al carrito.
    search.addEventListener("keydown", (event) => {
      if (event.key !== "Enter") return;
      event.preventDefault();
      const value = search.value.trim();
      if (!value) return;
      if (searchTimer) clearTimeout(searchTimer);
      const exact = resolveScannedCode(ctx.repos.products.list(), value);
      const matches = exact ? [exact] : filteredProducts();
      if (matches.length === 1) {
        addProduct(matches[0]!);
        search.value = "";
        renderGrid();
      } else if (!matches.length && /^\d{6,}$/.test(value)) {
        handleCode(value);
      } else {
        renderGrid();
      }
    });

    supplierFilter.addEventListener("change", renderGrid);

    grid.addEventListener("click", (event) => {
      const button = (event.target as HTMLElement).closest<HTMLElement>("[data-add]");
      if (!button) return;
      const result = ctx.sales.addToCart(button.dataset.add!);
      if (!result.ok) ctx.toast(result.error);
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
      const result = ctx.sales.addToCart(button.dataset.add!, 1, promo);
      if (!result.ok) ctx.toast(result.error);
      else if (product) {
        vibrate(40);
        ctx.toast(promo ? `${product.name} en oferta: ${fmtMoneyPesos(promo)}` : `${product.name} agregado`);
      }
    });

    root.querySelector<HTMLButtonElement>("#closeCatalog")!.addEventListener("click", () => {
      showAll = false;
      search.value = "";
      supplierFilter.value = "";
      renderGrid();
    });

    items.addEventListener("change", (event) => {
      const input = (event.target as HTMLElement).closest<HTMLInputElement>("[data-qty]");
      if (!input) return;
      const result = ctx.sales.setCartQty(input.dataset.qty!, input.value);
      if (!result.ok) ctx.toast(result.error);
    });

    items.addEventListener("click", (event) => {
      const target = event.target as HTMLElement;
      const remove = target.closest<HTMLElement>("[data-remove]");
      if (remove) {
        ctx.sales.removeFromCart(remove.dataset.remove!);
        return;
      }
      const inc = target.closest<HTMLElement>("[data-qty-inc]");
      const dec = target.closest<HTMLElement>("[data-qty-dec]");
      if (!inc && !dec) return;
      const productId = inc ? inc.dataset.qtyInc! : dec!.dataset.qtyDec!;
      const product = ctx.repos.products.byId(productId);
      if (!product) return;
      const step = qtyStep(product.um);
      const current = ctx.sales.cart().find((line) => line.productId === productId)?.qty ?? 0;
      const result = ctx.sales.setCartQty(productId, inc ? current + step : current - step);
      if (!result.ok) ctx.toast(result.error);
    });

    ctx.store.watch((s) => s.cart, renderCart);
    ctx.store.watch((s) => [s.customers, s.branches, s.currentBranchId] as const, renderCustomers);
    ctx.store.watch((s) => s.suppliers, () => {
      renderSupplierFilter();
      renderGrid();
    });
    ctx.store.watch(
      (s) => [s.products, s.product_stocks, s.branches, s.currentBranchId] as const,
      () => {
        renderGrid();
        renderCart();
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
                  <span>${fmtQty(item.qty)} ${item.um} · ${item.name}${item.regular_price ? html` <span class="offer-tag">Oferta</span>` : html``}</span>
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

    const runVoice = async (): Promise<void> => {
      if (!speechSupported()) {
        ctx.toast("Tu navegador no soporta dictado por voz");
        return;
      }
      voiceButton.disabled = true;
      voiceButton.textContent = "Escuchando...";
      try {
        const transcript = await listenOnce();
        voiceText.textContent = `Entendí: ${transcript}`;
        const localOrders = parseVoiceSale(transcript);
        let aiOrders: AiSaleItem[] = [];
        try {
          aiOrders = await parseSaleWithAi(ctx, transcript);
        } catch {
          /* sin IA disponible: vale el parser local */
        }
        const orders = aiOrders.length >= localOrders.length ? aiOrders : localOrders;
        const { matched, notFound } = matchOrdersToProducts(orders, ctx.repos.products.list());
        let added = 0;
        const names: string[] = [];
        matched.forEach(({ product, qty }) => {
          const result = ctx.sales.addToCart(product.id, qty);
          if (result.ok) {
            added += 1;
            names.push(`${fmtQty(qty)} ${product.um} ${product.name}`);
          }
        });
        const messages = [`${added} producto(s) agregados`];
        if (notFound.length) messages.push(`No encontré: ${notFound.join(", ")}`);
        ctx.toast(messages.join(". "));
        speak(
          added
            ? `Agregue ${names.join(", ")}. Revisa y presiona cobrar.`
            : "No encontré productos para agregar al carrito.",
          voiceEnabled()
        );
      } catch (error) {
        ctx.toast(error instanceof Error ? error.message : "No se pudo interpretar la venta");
      } finally {
        voiceButton.disabled = false;
        setHtml(voiceButton, html`${iconFor("mic")} Hablar venta`);
      }
    };
    voiceButton.addEventListener("click", () => void runVoice());

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
