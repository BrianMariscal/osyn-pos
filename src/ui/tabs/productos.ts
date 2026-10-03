import { esc, html, safe, setHtml } from "../../core/html";
import { nowISO } from "../../core/dates";
import { uid } from "../../core/id";
import { fmtMoneyPesos } from "../../core/money";
import { normalizeQty } from "../../core/qty";
import { SALE_GROUP_LABELS, SALE_GROUPS, UNITS, type Product, type SaleGroup, type Unit } from "../../core/types";
import { productMatches, productQrPayload, supplierCode, supplierLabel } from "../../domain/catalog";
import { detectSaleGroup } from "../../domain/sale-groups";
import { confirmDialog, openModal } from "../components/modal";
import { iconFor } from "../icons";
import { scanBarcode } from "../scanner";
import { parseCsvLine, parseSpreadsheetRows } from "./csv";
import { downloadText } from "./download";
import type { AppContext } from "../context";
import { categoryFieldMarkup, mountCategoryField } from "../category-field";
import type { TabModule } from "./tab-module";

export const productosTab: TabModule = {
  id: "productos",
  render(root, ctx) {
    setHtml(
      root,
      html`
        <div class="split">
          <article class="card">
            <h2 id="productFormTitle">Alta de producto</h2>
            <p class="hint" id="stockScopeHint"></p>
            <div class="actions wrap-actions">
              <button id="downloadTemplate" class="ghost" type="button">${iconFor("download")} Plantilla Excel</button>
              <label class="import-label">${iconFor("upload")} Importar productos
                <input id="importProducts" type="file" accept=".csv,.xls,text/csv,application/vnd.ms-excel">
              </label>
            </div>
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
              <div class="row">
                <label class="form-field">Proveedor
                  <select id="productSupplier" class="input"></select>
                </label>
                <label class="form-field">Piezas por caja / paquete
                  <input id="productPack" class="input" type="number" step="1" min="0" inputmode="numeric" placeholder="Ej. 12 (opcional)">
                </label>
              </div>
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
          </article>
          <article class="card">
            <h2>Productos registrados</h2>
            <div class="search-stack">
              <input id="productsSearch" class="input" type="search" placeholder="Buscar por nombre, código o proveedor (#3)" autocomplete="off">
              <select id="productsSupplierFilter" class="input" aria-label="Filtrar por proveedor"></select>
            </div>
            <p class="hint" id="productsCount"></p>
            <div id="productsList" class="list"></div>
          </article>
        </div>
      `
    );

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
    const groupInput = root.querySelector<HTMLSelectElement>("#productGroup")!;
    const stockInput = root.querySelector<HTMLInputElement>("#productStock")!;
    const minInput = root.querySelector<HTMLInputElement>("#productMin")!;
    const barcodeInput = root.querySelector<HTMLInputElement>("#productBarcode")!;
    const cancelEdit = root.querySelector<HTMLButtonElement>("#productCancel")!;
    const list = root.querySelector<HTMLElement>("#productsList")!;
    const hint = root.querySelector<HTMLElement>("#stockScopeHint")!;
    const listSearch = root.querySelector<HTMLInputElement>("#productsSearch")!;
    const listSupplier = root.querySelector<HTMLSelectElement>("#productsSupplierFilter")!;
    const countEl = root.querySelector<HTMLElement>("#productsCount")!;
    /** Existencia mostrada al empezar a editar: solo se guarda si el usuario la cambió. */
    let stockAtEdit: string | null = null;
    let searchTimer: ReturnType<typeof setTimeout> | undefined;

    const stockRowFor = (productId: string) =>
      ctx.repos.stocks.all().find(
        (row) => !row.deleted && row.product_id === productId && row.branch_id === ctx.branches.operationalId()
      );

    const sortedSuppliers = () =>
      ctx.repos.suppliers.list().sort((a, b) => (a.number ?? 0) - (b.number ?? 0) || a.name.localeCompare(b.name));

    const renderSupplierOptions = (): void => {
      const suppliers = sortedSuppliers();
      const formValue = supplierInput.value;
      const filterValue = listSupplier.value;
      setHtml(
        supplierInput,
        html`<option value="">Sin proveedor</option>${suppliers.map(
          (s) => html`<option value="${s.id}" ${s.id === formValue ? "selected" : null}>${supplierLabel(s)}</option>`
        )}`
      );
      setHtml(
        listSupplier,
        html`<option value="">Todos los proveedores</option>${suppliers.map(
          (s) => html`<option value="${s.id}" ${s.id === filterValue ? "selected" : null}>${supplierLabel(s)}</option>`
        )}<option value="none" ${filterValue === "none" ? "selected" : null}>Sin proveedor</option>`
      );
      listSupplier.classList.toggle("hidden", !suppliers.length);
    };

    const resetForm = (): void => {
      form.reset();
      category.set("Abarrotes");
      idInput.value = "";
      stockAtEdit = null;
      cancelEdit.hidden = true;
      minInput.value = "2";
      stockInput.disabled = false;
      formTitle.textContent = "Alta de producto";
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
      const supplierFilter = listSupplier.value;
      const products = all
        .filter((p) => !supplierFilter || (supplierFilter === "none" ? !p.supplier_id || !suppliers.has(p.supplier_id) : p.supplier_id === supplierFilter))
        .filter((p) => productMatches(p, listSearch.value, p.supplier_id ? suppliers.get(p.supplier_id) : undefined))
        .sort((a, b) => a.name.localeCompare(b.name));
      countEl.textContent = all.length ? `${products.length} de ${all.length} productos` : "";
      if (!products.length) {
        setHtml(list, html`<p class="muted">${all.length ? "Ningún producto coincide." : "Aún no hay productos."}</p>`);
        return;
      }
      setHtml(
        list,
        html`${products.map((product) => {
          const stock = stockRowFor(product.id);
          const low = (stock?.stock ?? 0) <= (stock?.min_stock ?? 0);
          const supplier = product.supplier_id ? suppliers.get(product.supplier_id) : undefined;
          const group = detectSaleGroup(product);
          return html`
            <div class="list-item ${low ? "low" : ""} ${product.active === false ? "inactive" : ""}">
              <div class="item-line"><strong>${product.name}</strong><strong>${fmtMoneyPesos(product.price)}</strong></div>
              <p class="muted">
                ${product.category || "Sin categoría"} · ${product.um} · Costo ${fmtMoneyPesos(product.cost)}
                · Stock ${stock ? fmtQtySafe(stock.stock) : "—"} (mín ${stock ? fmtQtySafe(stock.min_stock) : "—"})
              </p>
              <div class="tag-row">
                ${supplier ? html`<span class="tag">${supplierCode(supplier)} ${supplier.name}</span>` : html``}
                ${product.pack_size ? html`<span class="tag">Caja de ${product.pack_size}</span>` : html``}
                ${group !== "general" ? html`<span class="tag tag-accent">${SALE_GROUP_LABELS[group]}</span>` : html``}
                ${product.barcode ? html`<span class="tag">${iconFor("barcode")} ${product.barcode}</span>` : html``}
                ${product.active === false ? html`<span class="tag tag-off">Oculto</span>` : html``}
              </div>
              <div class="actions">
                <button class="ghost" type="button" data-edit="${product.id}">${iconFor("edit")} Editar</button>
                <button class="ghost" type="button" data-qr="${product.id}">QR</button>
                <button class="ghost" type="button" data-hide="${product.id}">${product.active === false ? "Mostrar" : "Ocultar"}</button>
                <button class="ghost danger" type="button" data-delete="${product.id}">${iconFor("trash")} Eliminar</button>
              </div>
            </div>
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
      ctx.repos.stocks.upsert({
        id: current?.id ?? `${id}:${ctx.branches.operationalId()}`,
        product_id: id,
        branch_id: ctx.branches.operationalId(),
        stock: stockChanged || !current ? normalizeQty(stockInput.value) : current.stock,
        min_stock: normalizeQty(minInput.value),
        updated_at: ts
      });
      resetForm();
      ctx.toast(existing ? "Producto actualizado" : "Producto guardado");
    });

    cancelEdit.addEventListener("click", resetForm);

    list.addEventListener("click", async (event) => {
      const target = event.target as HTMLElement;
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
        groupInput.value = product.sale_group ?? "";
        const stock = stockRowFor(product.id);
        stockInput.value = String(stock?.stock ?? 0);
        stockAtEdit = stockInput.value;
        minInput.value = String(stock?.min_stock ?? 0);
        barcodeInput.value = product.barcode ?? "";
        cancelEdit.hidden = false;
        formTitle.textContent = `Editando: ${product.name}`;
        form.scrollIntoView({ behavior: "smooth", block: "start" });
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
      if (searchTimer) clearTimeout(searchTimer);
      searchTimer = setTimeout(render, 180);
    });
    listSupplier.addEventListener("change", render);

    root.querySelector<HTMLButtonElement>("#downloadTemplate")!.addEventListener("click", () => {
      const rows = [
        ["nombre", "categoria", "um", "costo", "precio", "existencia", "minimo", "codigo", "piezas_caja"],
        ["Coca Cola 600 ml", "Refrescos", "Pza", "13", "18", "12", "4", "7501055300075", "24"],
        ["Azúcar", "Abarrotes", "Kg", "22", "30", "25.500", "5", "", ""],
        ["Arroz", "Abarrotes", "Kg", "24", "34", "18.250", "4", "", ""]
      ];
      const tableRows = rows
        .map((row) => `<Row>${row.map((cell) => `<Cell><Data ss:Type="String">${cell}</Data></Cell>`).join("")}</Row>`)
        .join("");
      const xml = `<?xml version="1.0"?><?mso-application progid="Excel.Sheet"?><Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet" xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet"><Worksheet ss:Name="Productos"><Table>${tableRows}</Table></Worksheet></Workbook>`;
      downloadText("plantilla-productos.xls", xml, "application/vnd.ms-excel;charset=utf-8");
    });

    root.querySelector<HTMLInputElement>("#importProducts")!.addEventListener("change", async (event) => {
      const input = event.target as HTMLInputElement;
      const file = input.files?.[0];
      if (!file) return;
      const text = await file.text();
      const dataLines = text.trim().startsWith("<?xml") || file.name.toLowerCase().endsWith(".xls")
        ? parseSpreadsheetRows(text).slice(1)
        : text.split(/\r?\n/).filter(Boolean).slice(1).map(parseCsvLine);
      let imported = 0;
      const branchId = ctx.branches.operationalId();
      const ts = nowISO();
      for (const row of dataLines) {
        const [name, category, third, fourth, fifth, sixth, seventh, eighth, ninth] = row;
        if (!name?.trim()) continue;
        const hasUnit = UNITS.some((unit) => unit.toLowerCase() === (third ?? "").trim().toLowerCase());
        const um = hasUnit ? (UNITS.find((unit) => unit.toLowerCase() === (third ?? "").trim().toLowerCase()) ?? "Pza") : "Pza";
        const cost = Number((hasUnit ? fourth : third) || 0);
        const price = Number((hasUnit ? fifth : fourth) || 0);
        const stock = normalizeQty(hasUnit ? sixth : fifth);
        const minStock = normalizeQty(hasUnit ? seventh : sixth);
        const barcode = (hasUnit ? eighth : seventh)?.trim();
        const packSize = Math.round(normalizeQty(hasUnit ? ninth : eighth));
        const cleanName = name.trim();
        const existing = ctx.repos.products.list().find((p) => p.name.toLowerCase() === cleanName.toLowerCase());
        const product: Product = {
          // Conserva proveedor, código y demás datos del producto existente
          ...existing,
          id: existing?.id ?? uid(),
          name: cleanName,
          category: (category ?? "Abarrotes").trim(),
          um,
          cost: Number.isFinite(cost) ? Math.max(0, cost) : 0,
          price: Number.isFinite(price) ? Math.max(0, price) : 0,
          barcode: barcode || existing?.barcode,
          pack_size: packSize > 1 ? packSize : existing?.pack_size,
          active: true,
          created_at: existing?.created_at ?? ts,
          updated_at: ts
        };
        ctx.repos.products.upsert(product);
        ctx.repos.stocks.upsert({
          id: `${product.id}:${branchId}`,
          product_id: product.id,
          branch_id: branchId,
          stock,
          min_stock: minStock,
          updated_at: ts
        });
        imported += 1;
      }
      input.value = "";
      ctx.toast(`${imported} productos importados a ${ctx.branches.name(branchId)}`);
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
