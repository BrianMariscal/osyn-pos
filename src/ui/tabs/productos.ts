import { esc, html, safe, setHtml } from "../../core/html";
import { nowISO } from "../../core/dates";
import { uid } from "../../core/id";
import { fmtMoneyPesos } from "../../core/money";
import { normalizeQty } from "../../core/qty";
import { SALE_GROUP_LABELS, SALE_GROUPS, UNITS, type Product, type SaleGroup, type Unit } from "../../core/types";
import { productQrPayload, supplierCode, supplierLabel } from "../../domain/catalog";
import { detectSaleGroup } from "../../domain/sale-groups";
import { confirmDialog, openModal } from "../components/modal";
import { iconFor } from "../icons";
import { scanBarcode } from "../scanner";
import type { AppContext } from "../context";
import { categoryFieldMarkup, mountCategoryField } from "../category-field";
import { mountProductFilters, productFiltersMarkup } from "../product-filters";
import { exportProducts, importProducts } from "../product-transfer-ui";
import { paginate, pagerClick, pagerMarkup } from "../pager";
import { mountSections } from "../sections";
import type { TabModule } from "./tab-module";

export const productosTab: TabModule = {
  id: "productos",
  render(root, ctx) {
    setHtml(
      root,
      html`
        <div class="split">
          <article class="card">
            <div class="section-title">
              <h2>Productos <span class="count-badge" data-tone="blue" id="productsTotal"></span></h2>
              <button id="newProductToggle" class="primary" type="button">${iconFor("plus")} Nuevo</button>
            </div>
            <input id="productsSearch" class="input" type="search" placeholder="Buscar por nombre o código de barras" autocomplete="off">
            ${productFiltersMarkup("products")}
            <p class="hint" id="productsCount"></p>
            <div id="productsList" class="collapsible-list"></div>
          </article>
          <article class="card" id="productFormCard">
            <details id="productFormBox" class="form-box">
              <summary><h2 id="productFormTitle">Nuevo producto</h2><span class="hint">Toca para abrir el formulario</span></summary>
              <p class="hint" id="stockScopeHint"></p>
            <form id="productForm" class="form">
              <input type="hidden" id="productId">
              <label class="form-field">Nombre
                <input id="productName" class="input" placeholder="Ej. Coca Cola 600 ml" required>
              </label>
              <div class="row">
                ${categoryFieldMarkup("productCategory")}
                <label class="form-field">Unidad
                  <select id="productUnit" class="input">
                    ${UNITS.map((unit) => html`<option value="${unit}">${unit}</option>`)}
                  </select>
                </label>
              </div>
              <div class="row">
                <label class="form-field">Costo
                  <input id="productCost" class="input" type="number" step="0.01" min="0" inputmode="decimal" placeholder="0.00">
                </label>
                <label class="form-field">Precio de venta
                  <input id="productPrice" class="input" type="number" step="0.01" min="0.01" inputmode="decimal" placeholder="0.00" required>
                </label>
              </div>
              <label class="form-field">Proveedor
                <select id="productSupplier" class="input"></select>
              </label>
              <div class="row">
                <label class="form-field">Piezas por caja / paquete
                  <input id="productPack" class="input" type="number" step="1" min="0" inputmode="numeric" placeholder="Ej. 20 (opcional)">
                </label>
                <label class="form-field">Precio por caja
                  <input id="productPackPrice" class="input" type="number" step="0.01" min="0" inputmode="decimal" placeholder="Ej. 100 (opcional)">
                </label>
              </div>
              <p class="hint">Con piezas por caja y precio por caja, en Venta podrás cobrar la caja completa o piezas sueltas.</p>
              <label class="form-field">Grupo en el corte
                <select id="productGroup" class="input">
                  <option value="">Automático (según categoría)</option>
                  ${SALE_GROUPS.map((group) => html`<option value="${group}">${SALE_GROUP_LABELS[group]}</option>`)}
                </select>
              </label>
              <div class="search-row">
                <label class="form-field">Código de barras / QR (opcional)
                  <input id="productBarcode" class="input" inputmode="numeric">
                </label>
                <button id="barcodeScan" class="ghost align-end" type="button">${iconFor("barcode")} Escanear</button>
              </div>
              <div class="row">
                <label class="form-field">Existencia (sucursal actual)
                  <input id="productStock" class="input" type="number" step="0.01" min="0" inputmode="decimal" placeholder="0" required>
                </label>
                <label class="form-field">Mínimo
                  <input id="productMin" class="input" type="number" step="0.01" min="0" inputmode="decimal" value="2">
                </label>
              </div>
              <div class="actions">
                <button class="primary" type="submit" id="productSubmit">Guardar producto</button>
                <button class="ghost" type="button" id="productCancel" hidden>Cancelar edición</button>
              </div>
            </form>
            </details>
            <div class="form-box-foot">
              <p class="micro">Migrar o respaldar</p>
              <p class="hint">El Excel incluye todos los datos (proveedor, categoría, código, piezas por caja, grupo del corte, existencia y mínimo) y se puede volver a importar.</p>
              <div class="actions wrap-actions">
                <button id="downloadTemplate" class="ghost" type="button">${iconFor("download")} Descargar Excel</button>
                <label class="import-label">${iconFor("upload")} Importar Excel / CSV
                  <input id="importProducts" type="file" accept=".csv,.xls,.xml,.txt,text/csv,application/vnd.ms-excel">
                </label>
              </div>
            </div>
          </article>
        </div>
      `
    );

    // En celular: una sección a la vez (en computadora van lado a lado)
    const articles = [...root.querySelectorAll<HTMLElement>(":scope > .split > article")];
    const sections = mountSections(root, [
      { id: "lista", label: "Productos", el: articles[0] ?? null },
      { id: "nuevo", label: "Nuevo producto", el: articles[1] ?? null }
    ], {
      // En celular la sección es el formulario: se abre directo
      onShow: (id) => {
        if (id === "nuevo") root.querySelector<HTMLDetailsElement>("#productFormBox")!.open = true;
      }
    });

    const form = root.querySelector<HTMLFormElement>("#productForm")!;
    const formTitle = root.querySelector<HTMLElement>("#productFormTitle")!;
    const idInput = root.querySelector<HTMLInputElement>("#productId")!;
    const nameInput = root.querySelector<HTMLInputElement>("#productName")!;
    const category = mountCategoryField(root, "productCategory", ctx);
    const unitInput = root.querySelector<HTMLSelectElement>("#productUnit")!;
    const costInput = root.querySelector<HTMLInputElement>("#productCost")!;
    const priceInput = root.querySelector<HTMLInputElement>("#productPrice")!;
    const supplierInput = root.querySelector<HTMLSelectElement>("#productSupplier")!;
    const packInput = root.querySelector<HTMLInputElement>("#productPack")!;
    const packPriceInput = root.querySelector<HTMLInputElement>("#productPackPrice")!;
    const groupInput = root.querySelector<HTMLSelectElement>("#productGroup")!;
    const stockInput = root.querySelector<HTMLInputElement>("#productStock")!;
    const minInput = root.querySelector<HTMLInputElement>("#productMin")!;
    const barcodeInput = root.querySelector<HTMLInputElement>("#productBarcode")!;
    const cancelEdit = root.querySelector<HTMLButtonElement>("#productCancel")!;
    const list = root.querySelector<HTMLElement>("#productsList")!;
    const hint = root.querySelector<HTMLElement>("#stockScopeHint")!;
    const listSearch = root.querySelector<HTMLInputElement>("#productsSearch")!;
    const countEl = root.querySelector<HTMLElement>("#productsCount")!;
    const totalEl = root.querySelector<HTMLElement>("#productsTotal")!;
    const formBox = root.querySelector<HTMLDetailsElement>("#productFormBox")!;
    /** Categorías y productos abiertos (se conservan al redibujar por sync). */
    const openGroups = new Set<string>();
    const openRows = new Set<string>();
    /** Página actual de cada lista ("all" = resultados de búsqueda, "g:<categoría>"). */
    const pages = new Map<string, number>();
    const PAGE_SEARCH = 10;
    const PAGE_GROUP = 8;
    /** Existencia mostrada al empezar a editar: solo se guarda si el usuario la cambió. */
    let stockAtEdit: string | null = null;
    let searchTimer: ReturnType<typeof setTimeout> | undefined;
    const filters = mountProductFilters(root, "products", ctx, () => {
      pages.set("all", 0);
      render();
    });

    const stockRowFor = (productId: string) =>
      ctx.repos.stocks.all().find(
        (row) => !row.deleted && row.product_id === productId && row.branch_id === ctx.branches.operationalId()
      );

    const sortedSuppliers = () =>
      ctx.repos.suppliers.list().sort((a, b) => (a.number ?? 0) - (b.number ?? 0) || a.name.localeCompare(b.name));

    const renderSupplierOptions = (): void => {
      const suppliers = sortedSuppliers();
      const formValue = supplierInput.value;
      setHtml(
        supplierInput,
        html`<option value="">Sin proveedor</option>${suppliers.map(
          (s) => html`<option value="${s.id}" ${s.id === formValue ? "selected" : null}>${supplierLabel(s)}</option>`
        )}`
      );
      filters.refresh();
    };

    const resetForm = (): void => {
      form.reset();
      category.set("Abarrotes");
      idInput.value = "";
      stockAtEdit = null;
      cancelEdit.hidden = true;
      minInput.value = "2";
      stockInput.disabled = false;
      formTitle.textContent = "Nuevo producto";
    };

    // Al elegir proveedor se sugiere su giro como categoría (si no se ha elegido otra).
    supplierInput.addEventListener("change", () => {
      const supplier = ctx.repos.suppliers.byId(supplierInput.value);
      if (supplier?.type && category.isDefault()) category.set(supplier.type);
    });

    root.querySelector<HTMLButtonElement>("#barcodeScan")!.addEventListener("click", async () => {
      try {
        const code = await scanBarcode();
        if (code) barcodeInput.value = code;
      } catch (error) {
        ctx.toast(error instanceof Error ? error.message : "No se pudo escanear");
      }
    });

    const render = (): void => {
      const branchName = ctx.branches.name(ctx.branches.operationalId());
      hint.textContent = `La existencia y el mínimo se guardan para: ${branchName}`;
      const all = ctx.repos.products.list();
      category.refresh();
      const suppliers = new Map(ctx.repos.suppliers.list().map((s) => [s.id, s]));
      filters.refresh();
      const products = filters.apply(all, listSearch.value);
      totalEl.textContent = all.length ? String(all.length) : "";
      const filtering = Boolean(listSearch.value.trim()) || filters.active();
      countEl.textContent = filtering && all.length ? `${products.length} de ${all.length} productos` : "";
      if (!products.length) {
        setHtml(list, html`<p class="empty-note">${all.length ? "Ningún producto coincide." : "Aún no hay productos. Toca “Nuevo” para dar de alta el primero."}</p>`);
        return;
      }
      const row = (product: Product) => {
        const stock = stockRowFor(product.id);
        const qty = stock?.stock ?? 0;
        const low = qty <= (stock?.min_stock ?? 0);
        const supplier = product.supplier_id ? suppliers.get(product.supplier_id) : undefined;
        const group = detectSaleGroup(product);
        return html`
          <details class="row-item ${product.active === false ? "inactive" : ""}" data-product="${product.id}" ${openRows.has(product.id) ? "open" : null}>
            <summary>
              <span class="row-title"><strong>${product.name}</strong><small class="muted">${product.um}${product.barcode ? ` · ${product.barcode}` : ""}${product.active === false ? " · Oculto" : ""}</small></span>
              <span class="row-price">${fmtMoneyPesos(product.price)}</span>
              <span class="stock-pill" data-tone="${qty <= 0 ? "coral" : low ? "amber" : "green"}">${stock ? fmtQtySafe(qty) : "—"}</span>
            </summary>
            <div class="row-body">
              <p class="muted">${product.category || "Sin categoría"} · Costo ${fmtMoneyPesos(product.cost)} · Mínimo ${stock ? fmtQtySafe(stock.min_stock) : "—"}</p>
              <div class="tag-row">
                ${supplier ? html`<span class="tag">${supplierCode(supplier)} ${supplier.name}</span>` : html``}
                ${product.pack_size ? html`<span class="tag">Caja de ${product.pack_size}${product.pack_price ? ` · ${fmtMoneyPesos(product.pack_price)}` : ""}</span>` : html``}
                ${group !== "general" ? html`<span class="tag tag-accent">${SALE_GROUP_LABELS[group]}</span>` : html``}
              </div>
              <div class="actions">
                <button class="ghost" type="button" data-edit="${product.id}">${iconFor("edit")} Editar</button>
                <button class="ghost" type="button" data-qr="${product.id}">QR</button>
                <button class="ghost" type="button" data-hide="${product.id}">${product.active === false ? "Mostrar" : "Ocultar"}</button>
                <button class="ghost danger" type="button" data-delete="${product.id}">${iconFor("trash")} Eliminar</button>
              </div>
            </div>
          </details>
        `;
      };
      if (filtering) {
        // Con búsqueda o filtro: resultados directos, de 10 en 10
        const page = paginate(products, pages.get("all") ?? 0, PAGE_SEARCH);
        setHtml(list, html`<div class="list">${page.items.map(row)}</div>${pagerMarkup("all", page)}`);
        return;
      }
      // Sin búsqueda: agrupados por categoría, plegados; solo se dibujan los abiertos
      const groups = new Map<string, Product[]>();
      for (const product of products) {
        const key = product.category?.trim() || "Sin categoría";
        groups.set(key, [...(groups.get(key) ?? []), product]);
      }
      const ordered = [...groups.entries()].sort((a, b) => a[0].localeCompare(b[0], "es"));
      setHtml(
        list,
        html`${ordered.map(([name, items]) => {
          const lowCount = items.filter((p) => {
            const stock = stockRowFor(p.id);
            return (stock?.stock ?? 0) <= (stock?.min_stock ?? 0);
          }).length;
          const open = openGroups.has(name);
          const page = open ? paginate(items, pages.get(`g:${name}`) ?? 0, PAGE_GROUP) : null;
          return html`
            <details class="group-box" data-group="${name}" ${open ? "open" : null}>
              <summary>
                <strong>${name}</strong>
                <span class="tag">${items.length}</span>
                ${lowCount ? html`<span class="count-badge" data-tone="amber" title="Productos en o bajo el mínimo">${lowCount} ${lowCount === 1 ? "bajo" : "bajos"}</span>` : html``}
              </summary>
              ${page ? html`<div class="list">${page.items.map(row)}</div>${pagerMarkup(`g:${name}`, page)}` : html``}
            </details>
          `;
        })}`
      );
    };

    form.addEventListener("submit", (event) => {
      event.preventDefault();
      const ts = nowISO();
      const id = idInput.value || uid();
      const existing = ctx.repos.products.byId(id);
      const name = nameInput.value.trim();
      const price = Number(priceInput.value || 0);
      if (!name || !(price > 0)) {
        ctx.toast("Nombre y precio son obligatorios");
        return;
      }
      const barcode = barcodeInput.value.trim();
      if (barcode && ctx.repos.products.list().some((p) => p.id !== id && p.barcode?.trim() === barcode)) {
        ctx.toast("Ese código de barras ya pertenece a otro producto");
        return;
      }
      const packSize = Math.round(normalizeQty(packInput.value));
      const packPrice = Math.round(Math.max(0, Number(packPriceInput.value || 0)) * 100) / 100;
      if (packPrice > 0 && packSize <= 1) {
        ctx.toast("Para vender por caja indica cuántas piezas trae la caja");
        return;
      }
      const product: Product = {
        // Conserva campos que este formulario no edita
        ...(existing && !existing.deleted ? existing : {}),
        id,
        name,
        category: category.get(),
        um: (unitInput.value as Unit) ?? "Pza",
        cost: Math.max(0, Number(costInput.value || 0)),
        price,
        barcode: barcode || undefined,
        supplier_id: supplierInput.value || undefined,
        pack_size: packSize > 1 ? packSize : undefined,
        pack_price: packSize > 1 && packPrice > 0 ? packPrice : undefined,
        sale_group: (groupInput.value as SaleGroup) || undefined,
        active: existing?.active !== false,
        deleted: false,
        created_at: existing?.created_at ?? ts,
        updated_at: ts
      };
      ctx.repos.products.upsert(product);
      const current = stockRowFor(id);
      // Al editar, la existencia solo se reescribe si el usuario la cambió:
      // así no se pierden las ventas hechas mientras el formulario estaba abierto.
      const stockChanged = stockAtEdit === null || stockInput.value !== stockAtEdit;
      const minValue = normalizeQty(minInput.value);
      // Sin cambios en existencia ni mínimo no se reescribe la fila: subirla
      // pisaría ventas recientes que el servidor aún no ha descontado.
      if (current && !stockChanged && normalizeQty(current.min_stock) === minValue) {
        resetForm();
        if (existing) {
          formBox.open = false;
          sections.show("lista");
        }
        ctx.toast(existing ? "Producto actualizado" : "Producto guardado");
        return;
      }
      ctx.repos.stocks.upsert({
        id: current?.id ?? `${id}:${ctx.branches.operationalId()}`,
        product_id: id,
        branch_id: ctx.branches.operationalId(),
        stock: stockChanged || !current ? normalizeQty(stockInput.value) : current.stock,
        min_stock: minValue,
        updated_at: ts
      });
      resetForm();
      if (existing) {
        formBox.open = false;
        sections.show("lista");
      }
      ctx.toast(existing ? "Producto actualizado" : "Producto guardado");
    });

    cancelEdit.addEventListener("click", () => {
      resetForm();
      formBox.open = false;
      sections.show("lista");
    });

    list.addEventListener("toggle", (event) => {
      const box = event.target as HTMLDetailsElement;
      if (box.dataset?.group !== undefined) {
        if (box.open) {
          // Solo una categoría abierta: abrir otra cierra la anterior
          openGroups.clear();
          openGroups.add(box.dataset.group);
          list.querySelectorAll<HTMLDetailsElement>("details.group-box[open]").forEach((other) => {
            if (other !== box) other.open = false;
          });
        } else openGroups.delete(box.dataset.group);
        // El contenido de la categoría se dibuja al abrirla
        if (box.open && !box.querySelector(".list")) render();
      } else if (box.dataset?.product) {
        if (box.open) openRows.add(box.dataset.product);
        else openRows.delete(box.dataset.product);
      }
    }, true);

    root.querySelector<HTMLButtonElement>("#newProductToggle")!.addEventListener("click", () => {
      if (idInput.value) resetForm();
      sections.show("nuevo");
      formBox.open = true;
      formBox.scrollIntoView({ behavior: "smooth", block: "start" });
      nameInput.focus({ preventScroll: true });
    });

    list.addEventListener("click", async (event) => {
      const target = event.target as HTMLElement;
      const paging = pagerClick(event);
      if (paging) {
        pages.set(paging.key, paging.page);
        openRows.clear();
        render();
        // Al cambiar de página se vuelve al inicio de esa lista
        const anchor = paging.key === "all" ? list : list.querySelector<HTMLElement>(`details.group-box[open]`);
        anchor?.scrollIntoView({ behavior: "smooth", block: "start" });
        return;
      }
      const editButton = target.closest<HTMLElement>("[data-edit]");
      if (editButton) {
        const product = ctx.repos.products.byId(editButton.dataset.edit!);
        if (!product) return;
        idInput.value = product.id;
        nameInput.value = product.name;
        category.set(product.category ?? "");
        unitInput.value = product.um;
        costInput.value = String(product.cost ?? 0);
        priceInput.value = String(product.price ?? 0);
        renderSupplierOptions();
        supplierInput.value = product.supplier_id && ctx.repos.suppliers.byId(product.supplier_id) ? product.supplier_id : "";
        packInput.value = product.pack_size ? String(product.pack_size) : "";
        packPriceInput.value = product.pack_price ? String(product.pack_price) : "";
        groupInput.value = product.sale_group ?? "";
        const stock = stockRowFor(product.id);
        stockInput.value = String(stock?.stock ?? 0);
        stockAtEdit = stockInput.value;
        minInput.value = String(stock?.min_stock ?? 0);
        barcodeInput.value = product.barcode ?? "";
        cancelEdit.hidden = false;
        formTitle.textContent = `Editando: ${product.name}`;
        sections.show("nuevo");
        formBox.open = true;
        formBox.scrollIntoView({ behavior: "smooth", block: "start" });
        nameInput.focus({ preventScroll: true });
        return;
      }
      const qrButton = target.closest<HTMLElement>("[data-qr]");
      if (qrButton) {
        const product = ctx.repos.products.byId(qrButton.dataset.qr!);
        if (product) void openProductQr(ctx, product);
        return;
      }
      const hideButton = target.closest<HTMLElement>("[data-hide]");
      if (hideButton) {
        const product = ctx.repos.products.byId(hideButton.dataset.hide!);
        if (!product) return;
        ctx.repos.products.upsert({ ...product, active: product.active === false, updated_at: nowISO() });
        return;
      }
      const deleteButton = target.closest<HTMLElement>("[data-delete]");
      if (deleteButton) {
        const product = ctx.repos.products.byId(deleteButton.dataset.delete!);
        if (!product) return;
        const confirmed = await confirmDialog({
          title: "Eliminar producto",
          message: `Se eliminará "${product.name}" de todas las sucursales. Las ventas pasadas no se afectan.`,
          confirmLabel: "Eliminar",
          danger: true
        });
        if (!confirmed) return;
        ctx.repos.products.softDelete(product.id);
        ctx.repos.stocks.all().filter((row) => row.product_id === product.id).forEach((row) => ctx.repos.stocks.softDelete(row.id));
        ctx.sales.purgeProduct(product.id);
        if (idInput.value === product.id) resetForm();
        ctx.toast("Producto eliminado");
      }
    });

    listSearch.addEventListener("input", () => {
      pages.set("all", 0);
      if (searchTimer) clearTimeout(searchTimer);
      searchTimer = setTimeout(render, 180);
    });

    root.querySelector<HTMLButtonElement>("#downloadTemplate")!.addEventListener("click", () => exportProducts(ctx, "xls"));

    root.querySelector<HTMLInputElement>("#importProducts")!.addEventListener("change", async (event) => {
      const input = event.target as HTMLInputElement;
      const file = input.files?.[0];
      if (!file) return;
      await importProducts(ctx, file);
      input.value = "";
    });

    ctx.store.watch((s) => s.suppliers, () => {
      renderSupplierOptions();
      render();
    });
    ctx.store.watch((s) => [s.products, s.product_stocks, s.branches, s.currentBranchId] as const, render);
  }
};

function fmtQtySafe(value: number | undefined): string {
  return normalizeQty(value ?? 0).toLocaleString("es-MX", { maximumFractionDigits: 3 });
}

/** Etiqueta QR imprimible: sirve para buscar en Venta productos sin código de barras. */
async function openProductQr(ctx: AppContext, product: Product): Promise<void> {
  const payload = productQrPayload(product);
  let svgMarkup = "";
  try {
    const { BrowserQRCodeSvgWriter } = await import("@zxing/browser");
    const svg = new BrowserQRCodeSvgWriter().write(payload, 220, 220);
    svg.setAttribute("role", "img");
    svg.setAttribute("aria-label", `Código QR de ${product.name}`);
    svgMarkup = new XMLSerializer().serializeToString(svg);
  } catch {
    ctx.toast("No se pudo generar el código QR");
    return;
  }
  const label = html`<div class="qr-label">${safe(svgMarkup)}<strong>${product.name}</strong><span>${fmtMoneyPesos(product.price)}</span></div>`;
  openModal({
    title: `QR de ${product.name}`,
    content: html`
      ${label}
      <p class="hint">Imprímelo y pégalo en el producto o en el anaquel. En Venta, toca "Escanear" y apunta al QR para agregarlo al carrito.</p>
    `,
    actions: [
      { label: "Cerrar", kind: "ghost" },
      {
        label: "Imprimir",
        kind: "primary",
        onClick: () => {
          const doc = `<!doctype html><html lang="es"><head><meta charset="utf-8"><title>QR ${esc(product.name)}</title><style>body{font-family:Arial,sans-serif;display:grid;place-items:center;padding:24px}.qr-label{display:grid;justify-items:center;gap:6px;border:1px dashed #999;padding:16px;border-radius:8px}.qr-label svg{width:220px;height:220px}</style></head><body>${label.__safe}</body></html>`;
          const url = URL.createObjectURL(new Blob([doc], { type: "text/html;charset=utf-8" }));
          const win = window.open(url, "_blank");
          win?.addEventListener("load", () => win.print());
          setTimeout(() => URL.revokeObjectURL(url), 60000);
        }
      }
    ]
  });
}
