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
import type { Product } from "../core/types";
import { unitsFromPacks, type StockReceipt } from "../domain/inventory-service";
import { productsForSupplier } from "../domain/catalog";
import type { AppContext } from "./context";

type LineMode = "pza" | "caja";

interface LineState {
  productId: string;
  mode: LineMode;
  qty: string;
  total: string;
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
  const blank = (): LineState => ({ productId: "", mode: "pza", qty: "", total: "" });
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
    return line.mode === "caja" ? unitsFromPacks(qty, packSizeOf(product)) : normalizeQty(qty);
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

  const lineMarkup = (line: LineState, index: number, list: Product[]) => {
    const supplierId = options.supplierId?.() ?? "";
    const option = (p: Product) =>
      html`<option value="${p.id}" ${p.id === line.productId ? "selected" : null}>${p.name} (${p.um})</option>`;
    const product = ctx.repos.products.byId(line.productId);
    const size = packSizeOf(product);
    return html`
      <div class="purchase-line" data-line="${index}">
        <select class="input" data-f="productId" aria-label="Producto ${index + 1}">
          ${list.length
            ? html`<option value="">Elige producto…</option>${list.map(option)}`
            : html`<option value="" disabled selected>${supplierId ? "Este proveedor no tiene productos" : "No hay productos"}</option>`}
        </select>
        <div class="purchase-qty">
          <input class="input" data-f="qty" type="number" step="0.01" min="0.01" inputmode="decimal" placeholder="${line.mode === "caja" ? "Cajas" : "Cantidad"}" value="${line.qty}">
          ${size
            ? html`<select class="input" data-f="mode" aria-label="Unidad de compra">
                <option value="caja" ${line.mode === "caja" ? "selected" : null}>Cajas</option>
                <option value="pza" ${line.mode === "pza" ? "selected" : null}>${product?.um ?? "Pza"}</option>
              </select>`
            : html`<span class="unit-tag">${product?.um ?? "Pza"}</span>`}
        </div>
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
    lines = lines.map((line) => (line.productId && !allowed.has(line.productId) ? { ...line, productId: "", mode: "pza" } : line));
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
      container.querySelector<HTMLElement>(`[data-line="${lineIndex}"] [data-f="${field}"]`)?.focus();
    }
  };

  const updateHint = (index: number): void => {
    const el = container.querySelector<HTMLElement>(`[data-hint="${index}"]`);
    const line = lines[index];
    if (el && line) el.textContent = hintFor(line);
  };

  container.addEventListener("input", (event) => {
    const field = (event.target as HTMLElement).closest<HTMLInputElement>("input[data-f]");
    const index = Number(field?.closest<HTMLElement>("[data-line]")?.dataset.line);
    const line = lines[index];
    if (!field || !line) return;
    if (field.dataset.f === "qty") line.qty = field.value;
    if (field.dataset.f === "total") line.total = field.value;
    updateHint(index);
  });

  container.addEventListener("change", (event) => {
    const field = (event.target as HTMLElement).closest<HTMLSelectElement>("select[data-f]");
    const index = Number(field?.closest<HTMLElement>("[data-line]")?.dataset.line);
    const line = lines[index];
    if (!field || !line) return;
    if (field.dataset.f === "productId") {
      line.productId = field.value;
      // Producto con caja: por defecto se captura en cajas.
      line.mode = packSizeOf(ctx.repos.products.byId(field.value)) ? "caja" : "pza";
      render();
    } else if (field.dataset.f === "mode") {
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
      container.querySelector<HTMLElement>(`[data-line="${lines.length - 1}"] [data-f="productId"]`)?.focus();
    },
    read() {
      const items: StockReceipt[] = [];
      for (const [index, line] of lines.entries()) {
        const label = lines.length > 1 ? ` (línea ${index + 1})` : "";
        if (!line.productId) return { ok: false, error: `Elige el producto${label}` };
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
