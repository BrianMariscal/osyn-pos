import { html, setHtml } from "../../../core/html";
import { fmtMoneyPesos } from "../../../core/money";
import { fmtQty } from "../../../core/qty";
import { type Product } from "../../../core/types";
import { resolveScannedCode } from "../../../domain/catalog";
import { scanBarcode } from "../../scanner";
import { vibrate } from "../../voice-recognition";
import { openNewProductModal } from "../inventario";
import type { VentaScene } from "./scene";

const MAX_RESULTS = 8;

/** Búsqueda del punto de venta: escribir, escanear y agregar al carrito. */
export interface VentaSearch {
  renderResults(): void;
  resetSearch(focus?: boolean): void;
  addProduct(product: Product, qty?: number): void;
  handleCode(code: string, qty?: number): void;
}

export function createSearch(scene: VentaScene): VentaSearch {
  const { ctx, ui, matchesFor, isMobile } = scene;
  const { search, resultsEl, items, scanButton } = ui;
  let searchTimer: ReturnType<typeof setTimeout> | undefined;
  let found: Product[] = [];
  let activeIndex = 0;

  // Por defecto no se muestran productos agotados: en la caja estorban. El
  // cajero puede revelarlos con el enlace "Ver N sin existencia"; la
  // preferencia se recuerda en este dispositivo.
  const OUT_OF_STOCK_KEY = "osyn.venta.mostrarAgotados";
  let showOutOfStock = false;
  try {
    showOutOfStock = localStorage.getItem(OUT_OF_STOCK_KEY) === "1";
  } catch {
    showOutOfStock = false;
  }
  const outOfStock = (product: Product): boolean => ctx.sales.stockOf(product.id) <= 0;
  /** Con agotados visibles, los deja al final para no tapar lo que sí hay. */
  const visibleMatches = (products: Product[]): Product[] =>
    showOutOfStock
      ? [...products].sort((a, b) => Number(outOfStock(a)) - Number(outOfStock(b)))
      : products.filter((product) => !outOfStock(product));

  /** "3*coca" o "3 x coca": cantidad antes del producto (como en las cajas registradoras). */
  const parseQuery = (raw: string): { qty: number; text: string } => {
    const match = /^\s*(\d+(?:[.,]\d+)?)\s*[*xX]\s*(.*)$/.exec(raw);
    if (!match) return { qty: 1, text: raw.trim() };
    const qty = Number(match[1]!.replace(",", "."));
    return { qty: Number.isFinite(qty) && qty > 0 ? qty : 1, text: match[2]!.trim() };
  };

  /** Lista corta de coincidencias bajo el buscador. Sin texto: no se muestra nada. */
  const renderResults = (): void => {
    const { text, qty } = parseQuery(search.value);
    if (!text) {
      found = [];
      resultsEl.classList.add("hidden");
      setHtml(resultsEl, html``);
      return;
    }
    const all = matchesFor(text);
    const visible = visibleMatches(all);
    const hidden = all.length - visible.length;
    found = visible.slice(0, MAX_RESULTS);
    const total = visible.length;
    activeIndex = Math.min(activeIndex, Math.max(0, found.length - 1));
    resultsEl.classList.remove("hidden");
    if (!found.length) {
      setHtml(
        resultsEl,
        html`
          <p class="search-empty">${hidden > 0 ? `Sin existencia para “${text}”.` : `Ningún producto coincide con “${text}”.`}</p>
          ${hidden > 0 ? html`<button class="link-btn" type="button" data-toggle-stock>Ver ${hidden} sin existencia</button>` : html``}
        `
      );
      return;
    }
    const stockToggle =
      hidden > 0 || showOutOfStock
        ? html` · <button class="link-btn" type="button" data-toggle-stock>${showOutOfStock ? "Ocultar agotados" : `Ver ${hidden} sin existencia`}</button>`
        : html``;
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
      })}${total > MAX_RESULTS ? html`<p class="search-more">${total - MAX_RESULTS} más: sigue escribiendo para afinar</p>` : html``}<p class="search-keys">↑ ↓ elegir · Enter agregar · Esc limpiar${stockToggle}</p>`
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
    const matches = visibleMatches(matchesFor(text));
    if (matches.length) addProduct(matches[Math.min(activeIndex, matches.length - 1)]!, qty);
    else if (/^\d{6,}$/.test(text)) handleCode(text, qty);
    else renderResults();
  });

  resultsEl.addEventListener("click", (event) => {
    const toggle = (event.target as HTMLElement).closest<HTMLElement>("[data-toggle-stock]");
    if (toggle) {
      event.preventDefault();
      showOutOfStock = !showOutOfStock;
      try {
        localStorage.setItem(OUT_OF_STOCK_KEY, showOutOfStock ? "1" : "0");
      } catch {
        // Sin almacenamiento: la preferencia dura solo esta sesión.
      }
      activeIndex = 0;
      renderResults();
      return;
    }
    const row = (event.target as HTMLElement).closest<HTMLElement>("[data-result]");
    const product = row && ctx.repos.products.byId(row.dataset.result!);
    if (product) addProduct(product, parseQuery(search.value).qty);
  });

  // Escáner de cámara: código de barras o QR
  scanButton.addEventListener("click", async () => {
    try {
      const code = await scanBarcode();
      if (code) handleCode(code);
    } catch (error) {
      ctx.toast(error instanceof Error ? error.message : "No se pudo escanear");
    }
  });

  return { renderResults, resetSearch, addProduct, handleCode };
}
