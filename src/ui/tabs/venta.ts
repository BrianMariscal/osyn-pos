import { html, setHtml } from "../../core/html";
import { fmtMoney, fmtMoneyPesos, lineTotalCents, speakPesos, sumCents } from "../../core/money";
import { fmtQty, normalizeQty } from "../../core/qty";
import { nowISO } from "../../core/dates";
import { uid } from "../../core/id";
import { PAYMENT_LABELS, type PaymentMethod, type Product, type Sale } from "../../core/types";
import { matchOrdersToProducts, findProductByBarcode } from "../../domain/voice/product-matcher";
import { parseVoiceSale } from "../../domain/voice/voice-parser";
import { parseSaleWithAi, type AiSaleItem } from "../../ai/assistant-client";
import { scanBarcode } from "../scanner";
import { openModal } from "../components/modal";
import { listenOnce, speak, speechSupported, vibrate, isVoiceEnabled } from "../voice-recognition";
import type { TabModule } from "./tab-module";

/** Paso del stepper según la unidad: piezas enteras, medio litro/kilo, 50 gramos. */
function qtyStep(um: string): number {
  if (um === "Pza") return 1;
  if (um === "Gr") return 50;
  return 0.5;
}

export const ventaTab: TabModule = {
  id: "venta",
  render(root, ctx) {
    setHtml(
      root,
      html`
        <div class="split">
          <article class="card">
            <div class="search-row">
              <input id="productSearch" class="input" placeholder="Buscar producto" autocomplete="off">
              <button id="scanButton" class="ghost" type="button" hidden>Escanear</button>
            </div>
            <div class="voice-sale-box">
              <button id="voiceSaleButton" class="primary" type="button">Hablar venta</button>
              <p id="voiceSaleText" class="hint">Di: "dos cocas, una leche y tres panes".</p>
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
                <div class="total-row"><span>Total</span><strong id="cartTotal">$0.00</strong></div>
                <label class="form-field">Forma de pago
                  <select id="paymentType" class="input">
                    <option value="efectivo">Efectivo</option>
                    <option value="transferencia">Transferencia</option>
                    <option value="tarjeta">Tarjeta</option>
                    <option value="fiado">Fiado</option>
                  </select>
                </label>
                <select id="creditCustomer" class="input hidden" aria-label="Cliente de fiado"></select>
                <div class="actions">
                  <button id="completeSale" class="primary">Cobrar</button>
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
    const items = root.querySelector<HTMLElement>("#cartItems")!;
    const totalEl = root.querySelector<HTMLElement>("#cartTotal")!;
    const toggleTotalEl = root.querySelector<HTMLElement>("#cartToggleTotal")!;
    const payment = root.querySelector<HTMLSelectElement>("#paymentType")!;
    const customer = root.querySelector<HTMLSelectElement>("#creditCustomer")!;
    const voiceButton = root.querySelector<HTMLButtonElement>("#voiceSaleButton")!;
    const voiceText = root.querySelector<HTMLElement>("#voiceSaleText")!;
    const cartCard = root.querySelector<HTMLElement>("#cartCard")!;
    let searchTimer: ReturnType<typeof setTimeout> | undefined;

    const voiceEnabled = isVoiceEnabled;

    // iPhone: sin dictado — se oculta el bloque de venta por voz
    root.querySelector(".voice-sale-box")?.classList.toggle("hidden", !speechSupported());

    const renderGrid = (): void => {
      const q = search.value.toLowerCase().trim();
      const products = ctx.repos.products
        .list()
        .filter((p) => p.active !== false && (!q || p.name.toLowerCase().includes(q)))
        .sort((a, b) => a.name.localeCompare(b.name));
      if (!products.length) {
        setHtml(grid, html`<p class="muted">Agrega productos para vender.</p>`);
        return;
      }
      setHtml(
        grid,
        html`${products.map((product) => {
          const stock = ctx.sales.stockOf(product.id);
          const min = ctx.sales.minStockOf(product.id);
          const out = stock <= 0;
          return html`<button
            class="product-tile ${stock <= min ? "low" : ""} ${out ? "out" : ""}"
            type="button"
            data-add="${product.id}"
            ${out ? "disabled" : null}
          >
            <strong>${product.name}</strong><span>${product.category || "Sin categoría"}</span>
            <b>${fmtMoneyPesos(product.price)}</b>
            <span class="tile-stock">Stock: ${fmtQty(stock)} ${product.um}</span>
          </button>`;
        })}`
      );
    };

    const renderCart = (): void => {
      const cart = ctx.sales.cart();
      customer.classList.toggle("hidden", payment.value !== "fiado");
      cartCard.classList.toggle("cart-empty", cart.length === 0);
      if (!cart.length) cartCard.classList.remove("cart-open");
      const countLabel = root.querySelector<HTMLElement>("#cartCount");
      if (countLabel) countLabel.textContent = cart.length ? `(${cart.length})` : "";
      const totalCents = sumCents(
        cart.map((line) => {
          const product = ctx.repos.products.byId(line.productId);
          return product ? lineTotalCents(line.qty, product.price) : 0;
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
          const lineTotal = lineTotalCents(line.qty, product.price);
          const step = qtyStep(product.um);
          return html`
            <div class="list-item cart-item">
              <div class="cart-item-info">
                <strong>${product.name}</strong>
                <p class="muted">${fmtMoneyPesos(product.price)} por ${product.um}</p>
              </div>
              <div class="qty-stepper" data-step="${step}">
                <button type="button" data-qty-dec="${line.productId}" aria-label="Menos cantidad">−</button>
                <input class="input" type="number" min="0" max="${ctx.sales.stockOf(line.productId)}" step="${step}" value="${line.qty}" data-qty="${line.productId}" inputmode="decimal" aria-label="Cantidad">
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
      const customers = ctx.repos.customers.list().filter((c) => c.branch_id === branchId);
      setHtml(
        customer,
        html`<option value="">Cliente de fiado</option>${customers.map(
          (c) => html`<option value="${c.id}">${c.name}</option>`
        )}`
      );
    };

    search.addEventListener("input", () => {
      if (searchTimer) clearTimeout(searchTimer);
      searchTimer = setTimeout(renderGrid, 180);
    });

    grid.addEventListener("click", (event) => {
      const button = (event.target as HTMLElement).closest<HTMLElement>("[data-add]");
      if (!button) return;
      const result = ctx.sales.addToCart(button.dataset.add!);
      if (!result.ok) ctx.toast(result.error);
    });

    items.addEventListener("change", (event) => {
      const input = (event.target as HTMLElement).closest<HTMLInputElement>("[data-qty]");
      if (!input) return;
      const result = ctx.sales.setCartQty(input.dataset.qty!, input.value);
      if (!result.ok) ctx.toast(result.error);
    });

    items.addEventListener("click", (event) => {
      const target = event.target as HTMLElement;
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

    items.addEventListener("click", (event) => {
      const button = (event.target as HTMLElement).closest<HTMLElement>("[data-remove]");
      if (button) ctx.sales.removeFromCart(button.dataset.remove!);
    });

    // La tarjeta del carrito en móvil siempre se muestra desplegada: nada se colapsa solo

    ctx.store.watch((s) => s.cart, renderCart);
    ctx.store.watch((s) => s.customers, renderCustomers);
    ctx.store.watch(
      (s) => [s.products, s.product_stocks, s.branches, s.currentBranchId] as const,
      () => {
        renderGrid();
        renderCart();
      }
    );

    payment.addEventListener("change", renderCart);

    root.querySelector<HTMLButtonElement>("#clearCart")!.addEventListener("click", () => ctx.sales.clearCart());

    // En móvil el carrito es un cajón colapsable: el toggle abre/cierra el cuerpo
    // para que la búsqueda y la cuadrícula de productos no queden tapadas.
    root.querySelector<HTMLButtonElement>("#cartToggle")!.addEventListener("click", () => {
      const open = cartCard.classList.toggle("cart-open");
      root.querySelector<HTMLButtonElement>("#cartToggle")!.setAttribute("aria-expanded", String(open));
    });

    root.querySelector<HTMLButtonElement>("#completeSale")!.addEventListener("click", () => {
      const method = payment.value as PaymentMethod;
      const customerId = method === "fiado" ? (customer.value || null) : null;
      const result = ctx.sales.completeSale({ payment: method, customerId });
      if (!result.ok) {
        ctx.toast(result.error);
        return;
      }
      ctx.toast(`Venta registrada: ${fmtMoneyPesos(result.sale.total)}`);
      speak(`Venta registrada por ${speakPesos(result.sale.total)}.`, voiceEnabled());
      vibrate(80);
      openReceipt(result.sale);
      renderCart();
    });

    // Código no registrado: alta rápida y directo al carrito
    const openRegisterByBarcode = (code: string): void => {
      openModal({
        title: "Producto nuevo",
        content: html`
          <p class="muted">El código ${code} no está registrado. Captura el producto para agregarlo.</p>
          <label class="form-field">Nombre
            <input id="rName" class="input">
          </label>
          <div class="row">
            <label class="form-field">Precio
              <input id="rPrice" class="input" type="number" step="0.01" min="0">
            </label>
            <label class="form-field">Costo
              <input id="rCost" class="input" type="number" step="0.01" min="0">
            </label>
          </div>
          <label class="form-field">Existencia inicial
            <input id="rStock" class="input" type="number" step="0.001" value="0">
          </label>
        `,
        actions: [
          { label: "Cancelar", kind: "ghost", onClick: (close) => close() },
          {
            label: "Crear y agregar",
            kind: "primary",
            onClick: (close) => {
              const nameInput = document.getElementById("rName") as HTMLInputElement;
              const price = Number((document.getElementById("rPrice") as HTMLInputElement).value || 0);
              const cost = Number((document.getElementById("rCost") as HTMLInputElement).value || 0);
              const stock = normalizeQty((document.getElementById("rStock") as HTMLInputElement).value);
              const name = nameInput.value.trim();
              if (!name || price <= 0) {
                ctx.toast("Nombre y precio son obligatorios");
                return;
              }
              const ts = nowISO();
              const product: Product = { id: uid(), name, category: "", um: "Pza", cost, price, barcode: code, active: true, created_at: ts, updated_at: ts };
              ctx.repos.products.upsert(product);
              const branchId = ctx.branches.operationalId();
              ctx.repos.stocks.upsert({ id: `${product.id}:${branchId}`, product_id: product.id, branch_id: branchId, stock, min_stock: 0, updated_at: ts });
              close();
              const added = ctx.sales.addToCart(product.id);
              ctx.toast(added.ok ? `${name} agregado` : added.error);
            }
          }
        ]
      });
    };

    const openReceipt = (sale: Sale): void => {
      const totalCents = sumCents(sale.items.map((item) => lineTotalCents(item.qty, item.price)));
      const customerName = sale.customer_id ? ctx.repos.customers.byId(sale.customer_id)?.name : undefined;
      openModal({
        title: "Venta registrada",
        content: html`
          <div class="receipt">
            ${sale.items.map(
              (item) => html`
                <div class="item-line">
                  <span>${fmtQty(item.qty)} ${item.um} · ${item.name}</span>
                  <strong>${fmtMoney(lineTotalCents(item.qty, item.price))}</strong>
                </div>
              `
            )}
            <div class="total-row receipt-total">
              <span>Total</span>
              <strong>${fmtMoney(totalCents)}</strong>
            </div>
            <p class="muted">${PAYMENT_LABELS[sale.payment]}${customerName ? ` · ${customerName}` : ""}</p>
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
        voiceButton.textContent = "Hablar venta";
      }
    };
    voiceButton.addEventListener("click", () => void runVoice());

    // Escáner de cámara: agrega el producto del código de barras
    const scanButton = root.querySelector<HTMLButtonElement>("#scanButton")!;
    scanButton.hidden = false;
    scanButton.addEventListener("click", async () => {
      try {
        const code = await scanBarcode();
        if (!code) return;
        const product = findProductByBarcode(ctx.repos.products.list(), code);
        if (!product) {
          openRegisterByBarcode(code);
          return;
        }
        const result = ctx.sales.addToCart(product.id);
        if (result.ok) {
          vibrate(40);
          ctx.toast(`${product.name} agregado`);
        } else {
          ctx.toast(result.error);
        }
      } catch (error) {
        ctx.toast(error instanceof Error ? error.message : "No se pudo escanear");
      }
    });

    renderGrid();
    renderCart();
    renderCustomers();
  }
};
