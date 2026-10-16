/**
 * Líneas de compra/entrada reutilizables (Proveedores y Entradas).
 * El estado vive aquí (no en el DOM): un re-render por sync no borra lo que el
 * usuario está capturando, y cada "Quitar" elimina SU línea.
 * Si el producto tiene piezas por caja, la cantidad se captura en cajas y se
 * convierte a piezas automáticamente.
 */
import { html, setHtml } from "../../core/html";
import { productsForSupplier, resolveScannedCode, searchProducts } from "../../domain/catalog";
import type { StockReceipt } from "../../domain/inventory-service";
import type { AppContext } from "../context";
import { scanBarcode } from "../scanner";
import { activeProducts, baseQty, chooseProduct } from "./lines";
import { comboPop, hintFor, lineMarkup, qtyMarkup } from "./markup";
import { packSizeOf, type LineState, type PurchaseLines, type PurchaseLinesOptions } from "./types";

export type { PurchaseLines, PurchaseLinesOptions } from "./types";

export function mountPurchaseLines(container: HTMLElement, ctx: AppContext, options: PurchaseLinesOptions): PurchaseLines {
  const blank = (): LineState => ({ productId: "", mode: "pza", qty: "", total: "", search: "", open: false });
  let lines: LineState[] = [blank()];

  const render = (): void => {
    // Con proveedor elegido solo se compran SUS productos.
    const supplierId = options.supplierId?.() ?? "";
    const list = productsForSupplier(activeProducts(ctx), supplierId);
    const allowed = new Set(list.map((product) => product.id));
    // Productos que ya no existen o no son del proveedor se limpian de las líneas.
    lines = lines.map((line) => (line.productId && !allowed.has(line.productId) ? { ...line, productId: "", mode: "pza", search: "" } : line));
    const focused = document.activeElement as HTMLElement | null;
    const focusKey = focused && container.contains(focused) ? `${focused.closest<HTMLElement>("[data-line]")?.dataset.line}|${focused.dataset.f}` : "";
    setHtml(
      container,
      html`${supplierId && !list.length
        ? html`<p class="hint notice">Este proveedor aún no tiene productos asociados. Asócialos en Proveedores › Productos.</p>`
        : html``}${lines.map((line, index) => lineMarkup(ctx, options, line, index, list, lines.length > 1))}`
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
    if (el && line) el.textContent = hintFor(ctx, line);
  };

  const pick = (index: number, productId: string): void => {
    const line = lines[index];
    const product = ctx.repos.products.byId(productId);
    if (!line || !product) return;
    chooseProduct(line, product);
    line.search = product.name;
    line.open = false;
    render();
    container.querySelector<HTMLElement>(`[data-line="${index}"] [data-f="qty"]`)?.focus();
  };

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
    if (pop) setHtml(pop, comboPop(ctx, line, productsForSupplier(activeProducts(ctx), options.supplierId?.() ?? "")));
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
      const allowed = productsForSupplier(activeProducts(ctx), options.supplierId?.() ?? "");
      const product = resolveScannedCode(allowed, code);
      if (product) pick(index, product.id);
      else ctx.toast(resolveScannedCode(activeProducts(ctx), code) ? "Ese producto no es de este proveedor" : "Ese código no está registrado");
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
      const list = productsForSupplier(activeProducts(ctx), options.supplierId?.() ?? "");
      const best = field.value.trim() ? searchProducts(list, field.value)[0] : undefined;
      const row = field.closest<HTMLElement>("[data-line]")!;
      if ((best?.id ?? "") !== line.productId) {
        chooseProduct(line, best);
        // Solo se redibuja la cantidad/unidad: el buscador conserva el foco
        setHtml(row.querySelector<HTMLElement>(".purchase-qty")!, qtyMarkup(ctx, line));
      }
      setHtml(row.querySelector<HTMLElement>(".combo-pop")!, comboPop(ctx, line, list));
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
        const qty = baseQty(ctx, line);
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
