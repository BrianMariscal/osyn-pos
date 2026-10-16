import { html, setHtml, type SafeHtml } from "../../../core/html";
import { lineTotalCents, sumCents } from "../../../core/money";
import { type Product, type Supplier } from "../../../core/types";
import { searchProducts } from "../../../domain/catalog";
import type { AppContext } from "../../context";
import { iconFor } from "../../icons";
import { createBulkTools, type BulkTools } from "./bulk";

/** Referencias del punto de venta que comparten todas las secciones. */
export interface VentaRefs {
  search: HTMLInputElement;
  resultsEl: HTMLElement;
  items: HTMLElement;
  cartBadge: HTMLElement;
  payPanel: HTMLElement;
  payMethods: HTMLElement;
  totalEl: HTMLElement;
  totalLabelEl: HTMLElement;
  payment: HTMLSelectElement;
  creditBox: HTMLElement;
  customer: HTMLSelectElement;
  newCustomerFields: HTMLElement;
  ncName: HTMLInputElement;
  ncPhone: HTMLInputElement;
  ncNotes: HTMLInputElement;
  creditHint: HTMLElement;
  internalHint: HTMLElement;
  completeButton: HTMLButtonElement;
  cashBox: HTMLElement;
  cashInput: HTMLInputElement;
  cashQuick: HTMLElement;
  cashChangeEl: HTMLElement;
  posBar: HTMLElement;
  posBarTotal: HTMLElement;
  posBarCount: HTMLElement;
  posBarPay: HTMLButtonElement;
  returnSale: HTMLButtonElement;
  clearCart: HTMLButtonElement;
  scanButton: HTMLButtonElement;
  showShortcuts: HTMLButtonElement;
}

/** Base compartida de la pestaña Venta: markup, referencias y consultas. */
export interface VentaScene {
  ctx: AppContext;
  root: HTMLElement;
  ui: VentaRefs;
  bulk: BulkTools;
  isMobile(): boolean;
  matchesFor(query: string): Product[];
  cartTotalCents(): number;
}

/** Paso del stepper según la unidad: piezas enteras, medio litro/kilo, 50 gramos. */
export function qtyStep(um: string): number {
  if (um === "Pza") return 1;
  if (um === "Gr") return 50;
  return 0.5;
}

export function createVentaScene(root: HTMLElement, ctx: AppContext): VentaScene {
  setHtml(root, ventaMarkup());
  const ui = collectRefs(root);
  const suppliersById = (): Map<string, Supplier> => new Map(ctx.repos.suppliers.list().map((s) => [s.id, s]));
  const sellable = (): Product[] => ctx.repos.products.list().filter((p) => p.active !== false);
  const matchesFor = (query: string): Product[] => {
    const suppliers = suppliersById();
    return searchProducts(sellable(), query, (p) => (p.supplier_id ? suppliers.get(p.supplier_id) : undefined));
  };
  const isMobile = (): boolean => Boolean(window.matchMedia?.("(max-width: 860px)").matches);
  const cartTotalCents = (): number =>
    sumCents(
      ctx.sales.cart().map((line) => (ctx.repos.products.byId(line.productId) ? lineTotalCents(line.qty, ctx.sales.unitPrice(line)) : 0))
    );
  return { ctx, root, ui, bulk: createBulkTools(ctx), isMobile, matchesFor, cartTotalCents };
}

/** HTML del punto de venta: buscar/escanear, renglones y cobro. */
function ventaMarkup(): SafeHtml {
  return html`
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
  `;
}

function collectRefs(root: HTMLElement): VentaRefs {
  return {
    search: root.querySelector<HTMLInputElement>("#productSearch")!,
    resultsEl: root.querySelector<HTMLElement>("#searchResults")!,
    items: root.querySelector<HTMLElement>("#cartItems")!,
    cartBadge: root.querySelector<HTMLElement>("#cartBadge")!,
    payPanel: root.querySelector<HTMLElement>("#payPanel")!,
    payMethods: root.querySelector<HTMLElement>("#payMethods")!,
    totalEl: root.querySelector<HTMLElement>("#cartTotal")!,
    totalLabelEl: root.querySelector<HTMLElement>("#cartTotalLabel")!,
    payment: root.querySelector<HTMLSelectElement>("#paymentType")!,
    creditBox: root.querySelector<HTMLElement>("#creditBox")!,
    customer: root.querySelector<HTMLSelectElement>("#creditCustomer")!,
    newCustomerFields: root.querySelector<HTMLElement>("#newCustomerFields")!,
    ncName: root.querySelector<HTMLInputElement>("#ncName")!,
    ncPhone: root.querySelector<HTMLInputElement>("#ncPhone")!,
    ncNotes: root.querySelector<HTMLInputElement>("#ncNotes")!,
    creditHint: root.querySelector<HTMLElement>("#creditHint")!,
    internalHint: root.querySelector<HTMLElement>("#internalHint")!,
    completeButton: root.querySelector<HTMLButtonElement>("#completeSale")!,
    cashBox: root.querySelector<HTMLElement>("#cashBox")!,
    cashInput: root.querySelector<HTMLInputElement>("#cashReceived")!,
    cashQuick: root.querySelector<HTMLElement>("#cashQuick")!,
    cashChangeEl: root.querySelector<HTMLElement>("#cashChange")!,
    posBar: root.querySelector<HTMLElement>("#posBar")!,
    posBarTotal: root.querySelector<HTMLElement>("#posBarTotal")!,
    posBarCount: root.querySelector<HTMLElement>("#posBarCount")!,
    posBarPay: root.querySelector<HTMLButtonElement>("#posBarPay")!,
    returnSale: root.querySelector<HTMLButtonElement>("#returnSale")!,
    clearCart: root.querySelector<HTMLButtonElement>("#clearCart")!,
    scanButton: root.querySelector<HTMLButtonElement>("#scanButton")!,
    showShortcuts: root.querySelector<HTMLButtonElement>("#showShortcuts")!
  };
}
