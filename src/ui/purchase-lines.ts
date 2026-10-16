/**
 * Líneas de compra/entrada reutilizables (Proveedores y Entradas).
 * El estado vive aquí (no en el DOM): un re-render por sync no borra lo que el
 * usuario está capturando, y cada "Quitar" elimina SU línea.
 * Si el producto tiene piezas por caja, la cantidad se captura en cajas y se
 * convierte a piezas automáticamente.
 */
import { html, setHtml } from "../core/html";
import { fmtMoney, toCents } from "../core/money";
import { fmtQty, normalizeQty } from "../core/qty";
import { isBulkUnit, normalizeQtyForUnit } from "../core/units";
import type { Product } from "../core/types";
import { unitsFromPacks, type StockReceipt } from "../domain/inventory-service";
import { productsForSupplier, resolveScannedCode, searchProducts } from "../domain/catalog";
import { iconFor } from "./icons";
import { scanBarcode } from "./scanner";
import type { AppContext } from "./context";

type LineMode = "pza" | "caja";

interface LineState {
  productId: string;
  mode: LineMode;
  qty: string;
  total: string;
  /** Texto del buscador de producto de la línea. */
  search: string;
  /** Sugerencias visibles mientras se escribe. */
  open: boolean;
}

export interface PurchaseLinesOptions {
  /** true: el total pagado es obligatorio (compras); false: opcional (entradas). */
  requireTotal: boolean;
  /** Proveedor elegido: sus productos se listan primero. */
  supplierId?: () => string;
}

export interface PurchaseLines {
  render(): void;
  reset(): void;
  addLine(): void;
  read(): { ok: true; items: StockReceipt[] } | { ok: false; error: string };
}

function packSizeOf(product: Product | undefined): number {
  const size = normalizeQty(product?.pack_size ?? 0);
  return size > 1 ? size : 0;
}

export function mountPurchaseLines(container: HTMLElement, ctx: AppContext, options: PurchaseLinesOptions): PurchaseLines {
  const blank = (): LineState => ({ productId: "", mode: "pza", qty: "", total: "", search: "", open: false });
  let lines: LineState[] = [blank()];

  const products = (): Product[] =>
    ctx.repos.products
      .list()
      .filter((product) => product.active !== false)
      .sort((a, b) => a.name.localeCompare(b.name));

  const baseQty = (line: LineState): number => {
    const product = ctx.repos.products.byId(line.productId);
    const qty = Number(line.qty || 0);
    if (!Number.isFinite(qty) || qty <= 0) return 0;
    return line.mode === "caja" ? unitsFromPacks(qty, packSizeOf(product)) : normalizeQtyForUnit(qty, product?.um);
  };

  const hintFor = (line: LineState): string => {
    const product = ctx.repos.products.byId(line.productId);
    if (!product) return "";
    const units = baseQty(line);
    const parts: string[] = [];
    const size = packSizeOf(product);
    if (line.mode === "caja" && size) parts.push(`= ${fmtQty(units)} ${product.um} (${size} por caja)`);
    else if (size) parts.push(`Caja de ${size} ${product.um}`);
    const total = Number(line.total || 0);
    if (units > 0 && total > 0) parts.push(`${fmtMoney(Math.round(toCents(total) / units))} por ${product.um}`);
    return parts.join(" · ");
  };

  const SUGGESTIONS = 6;

  /** Buscador de producto: al escribir se elige solo el mejor resultado; los demás se pueden tocar. */
  const productField = (line: LineState, index: number, list: Product[]) => {
    const supplierId = options.supplierId?.() ?? "";
    if (!list.length) {
      return html`<input class="input" disabled placeholder="${supplierId ? "Este proveedor no tiene productos" : "No hay productos"}">`;
    }
    return html`
      <div class="combo-row">
        <input class="input" data-f="search" type="search" placeholder="Busca producto o código de barras" autocomplete="off"
          role="combobox" aria-label="Producto ${index + 1}" value="${line.search}">
        <button class="primary scan-btn" type="button" data-scan-line title="Escanear código de barras o QR" aria-label="Escanear producto ${index + 1}">${iconFor("barcode")}</button>
      </div>
      <div class="combo-pop">${comboPop(line, list)}</div>
    `;
  };

  const comboPop = (line: LineState, list: Product[]) => {
    const query = line.search.trim();
    const found = line.open && query ? searchProducts(list, query).slice(0, SUGGESTIONS) : [];
    const selected = ctx.repos.products.byId(line.productId);
    return html`
      ${line.open && query
        ? html`<div class="combo-list" role="listbox">
            ${found.length
              ? found.map(
                  (p) => html`<button type="button" role="option" class="combo-option ${p.id === line.productId ? "active" : ""}" data-pick="${p.id}" aria-selected="${p.id === line.productId ? "true" : "false"}">
                    <span>${p.name}</span><small class="muted">${p.um}${p.cost ? ` · costo ${fmtMoney(toCents(p.cost))}` : ""}</small>
                  </button>`
                )
              : html`<p class="combo-empty">Ningún producto coincide</p>`}
          </div>`
        : html``}
      ${selected && !line.open ? html`<span class="combo-picked">✓ ${selected.name} (${selected.um})</span>` : html``}
    `;
  };

  const qtyMarkup = (line: LineState) => {
    const product = ctx.repos.products.byId(line.productId);
    const size = packSizeOf(product);
    return html`
      <input class="input" data-f="qty" type="number" step="${line.mode === "pza" && isBulkUnit(product?.um) ? "any" : "0.01"}" min="0.01" inputmode="decimal" placeholder="${line.mode === "caja" ? "Cajas" : "Cantidad"}" value="${line.qty}">
      ${size
        ? html`<select class="input" data-f="mode" aria-label="Unidad de compra">
            <option value="caja" ${line.mode === "caja" ? "selected" : null}>Cajas</option>
            <option value="pza" ${line.mode === "pza" ? "selected" : null}>${product?.um ?? "Pza"}</option>
          </select>`
        : html`<span class="unit-tag">${product?.um ?? "Pza"}</span>`}
    `;
  };

  const lineMarkup = (line: LineState, index: number, list: Product[]) => {
    return html`
      <div class="purchase-line" data-line="${index}">
        <div class="purchase-product combo">${productField(line, index, list)}</div>
        <div class="purchase-qty">${qtyMarkup(line)}</div>
        <input class="input" data-f="total" type="number" step="0.01" min="0" inputmode="decimal" placeholder="${options.requireTotal ? "Total pagado" : "Total pagado (opcional)"}" value="${line.total}">
        <button class="ghost danger" type="button" data-remove-line="${index}" aria-label="Quitar producto" ${lines.length > 1 ? null : "disabled"}>Quitar</button>
        <p class="hint purchase-hint" data-hint="${index}">${hintFor(line)}</p>
      </div>
    `;
  };

  const render = (): void => {
    // Con proveedor elegido solo se compran SUS productos.
    const supplierId = options.supplierId?.() ?? "";
    const list = productsForSupplier(products(), supplierId);
    const allowed = new Set(list.map((product) => product.id));
    // Productos que ya no existen o no son del proveedor se limpian de las líneas.
    lines = lines.map((line) => (line.productId && !allowed.has(line.productId) ? { ...line, productId: "", mode: "pza", search: "" } : line));
    const focused = document.activeElement as HTMLElement | null;
    const focusKey = focused && container.contains(focused) ? `${focused.closest<HTMLElement>("[data-line]")?.dataset.line}|${focused.dataset.f}` : "";
    setHtml(
      container,
      html`${supplierId && !list.length
        ? html`<p class="hint notice">Este proveedor aún no tiene productos asociados. Asócialos en Proveedores › Productos.</p>`
        : html``}${lines.map((line, index) => lineMarkup(line, index, list))}`
    );
    if (focusKey) {
      const [lineIndex, field] = focusKey.split("|");
      const el = container.querySelector<HTMLInputElement>(`[data-line="${lineIndex}"] [data-f="${field}"]`);
      el?.focus();
      // El buscador conserva el cursor al final mientras se escribe
      if (el && field === "search") el.setSelectionRange(el.value.length, el.value.length);
    }
  };

  const updateHint = (index: number): void => {
    const el = container.querySelector<HTMLElement>(`[data-hint="${index}"]`);
    const line = lines[index];
    if (el && line) el.textContent = hintFor(line);
  };

  const choose = (line: LineState, product: Product | undefined): void => {
    line.productId = product?.id ?? "";
    // Producto con caja: por defecto se captura en cajas.
    line.mode = packSizeOf(product) ? "caja" : "pza";
  };

  const pick = (index: number, productId: string): void => {
    const line = lines[index];
    const product = ctx.repos.products.byId(productId);
    if (!line || !product) return;
    choose(line, product);
    line.search = product.name;
    line.open = false;
    render();
    container.querySelector<HTMLElement>(`[data-line="${index}"] [data-f="qty"]`)?.focus();
  };

  // Se elige con un toque/clic completo: en celular, poner el dedo para desplazar
  // la lista ya NO elige (antes se usaba pointerdown y se elegía al hacer scroll).
  // Con mouse, mousedown evita que el buscador pierda el foco antes del clic.
  container.addEventListener("mousedown", (event) => {
    if ((event.target as HTMLElement).closest("[data-pick], .combo-list")) event.preventDefault();
  });
  // Escáner por línea: el producto leído queda elegido directo
  container.addEventListener("click", async (event) => {
    const scan = (event.target as HTMLElement).closest<HTMLElement>("[data-scan-line]");
    if (!scan) return;
    const index = Number(scan.closest<HTMLElement>("[data-line]")?.dataset.line);
    try {
      const code = await scanBarcode();
      if (!code) return;
      const allowed = productsForSupplier(products(), options.supplierId?.() ?? "");
      const product = resolveScannedCode(allowed, code);
      if (product) pick(index, product.id);
      else ctx.toast(resolveScannedCode(products(), code) ? "Ese producto no es de este proveedor" : "Ese código no está registrado");
    } catch (error) {
      ctx.toast(error instanceof Error ? error.message : "No se pudo escanear");
    }
  });

  container.addEventListener("click", (event) => {
    const option = (event.target as HTMLElement).closest<HTMLElement>("[data-pick]");
    if (!option) return;
    pick(Number(option.closest<HTMLElement>("[data-line]")?.dataset.line), option.dataset.pick!);
  });
  container.addEventListener("keydown", (event) => {
    const field = (event.target as HTMLElement).closest<HTMLInputElement>('input[data-f="search"]');
    if (!field || event.key !== "Enter") return;
    event.preventDefault();
    const index = Number(field.closest<HTMLElement>("[data-line]")?.dataset.line);
    const line = lines[index];
    if (line?.productId) pick(index, line.productId);
  });
  container.addEventListener("focusout", (event) => {
    const field = (event.target as HTMLElement).closest<HTMLInputElement>('input[data-f="search"]');
    if (!field) return;
    const line = lines[Number(field.closest<HTMLElement>("[data-line]")?.dataset.line)];
    if (!line?.open) return;
    // Si el foco pasa a la lista (toque en celular), se deja abierta para elegir
    const next = (event as FocusEvent).relatedTarget as HTMLElement | null;
    if (next?.closest(".combo-list")) return;
    // En celular el toque llega después del blur: se espera un momento antes de cerrar
    window.setTimeout(() => closeCombo(field, line), 250);
  });

  const closeCombo = (field: HTMLInputElement, line: LineState): void => {
    if (!line.open || document.activeElement === field) return;
    // Se queda el mejor resultado; el texto muestra su nombre completo
    line.open = false;
    const product = ctx.repos.products.byId(line.productId);
    if (product) {
      line.search = product.name;
      field.value = product.name;
    }
    const pop = field.closest<HTMLElement>("[data-line]")?.querySelector<HTMLElement>(".combo-pop");
    if (pop) setHtml(pop, comboPop(line, productsForSupplier(products(), options.supplierId?.() ?? "")));
  };

  container.addEventListener("input", (event) => {
    const field = (event.target as HTMLElement).closest<HTMLInputElement>("input[data-f]");
    const index = Number(field?.closest<HTMLElement>("[data-line]")?.dataset.line);
    const line = lines[index];
    if (!field || !line) return;
    if (field.dataset.f === "qty") line.qty = field.value;
    if (field.dataset.f === "total") line.total = field.value;
    if (field.dataset.f === "search") {
      line.search = field.value;
      line.open = true;
      const list = productsForSupplier(products(), options.supplierId?.() ?? "");
      const best = field.value.trim() ? searchProducts(list, field.value)[0] : undefined;
      const row = field.closest<HTMLElement>("[data-line]")!;
      if ((best?.id ?? "") !== line.productId) {
        choose(line, best);
        // Solo se redibuja la cantidad/unidad: el buscador conserva el foco
        setHtml(row.querySelector<HTMLElement>(".purchase-qty")!, qtyMarkup(line));
      }
      setHtml(row.querySelector<HTMLElement>(".combo-pop")!, comboPop(line, list));
      updateHint(index);
      return;
    }
    updateHint(index);
  });

  container.addEventListener("change", (event) => {
    const field = (event.target as HTMLElement).closest<HTMLSelectElement>("select[data-f]");
    const index = Number(field?.closest<HTMLElement>("[data-line]")?.dataset.line);
    const line = lines[index];
    if (!field || !line) return;
    if (field.dataset.f === "mode") {
      line.mode = field.value === "caja" ? "caja" : "pza";
      render();
    }
  });

  container.addEventListener("click", (event) => {
    const button = (event.target as HTMLElement).closest<HTMLElement>("[data-remove-line]");
    if (!button || lines.length <= 1) return;
    lines = lines.filter((_, index) => index !== Number(button.dataset.removeLine));
    render();
  });

  return {
    render,
    reset() {
      lines = [blank()];
      render();
    },
    addLine() {
      lines = [...lines, blank()];
      render();
      container.querySelector<HTMLElement>(`[data-line="${lines.length - 1}"] [data-f="search"]`)?.focus();
    },
    read() {
      const items: StockReceipt[] = [];
      for (const [index, line] of lines.entries()) {
        const label = lines.length > 1 ? ` (línea ${index + 1})` : "";
        if (!line.productId) return { ok: false, error: `Busca y elige el producto${label}` };
        const qty = baseQty(line);
        if (qty <= 0) return { ok: false, error: `Escribe una cantidad válida${label}` };
        const total = Number(line.total || 0);
        if (!Number.isFinite(total) || total < 0 || (options.requireTotal && total <= 0)) {
          return { ok: false, error: `Escribe el total pagado${label}` };
        }
        const size = packSizeOf(ctx.repos.products.byId(line.productId));
        items.push({
          productId: line.productId,
          qty,
          totalPaid: total,
          ...(line.mode === "caja" && size ? { packs: Number(line.qty), packSize: size } : {})
        });
      }
      return { ok: true, items };
    }
  };
}
