import { html, setHtml } from "../../core/html";
import { nowISO } from "../../core/dates";
import { uid } from "../../core/id";
import { fmtMoneyPesos } from "../../core/money";
import { normalizeQty } from "../../core/qty";
import { UNITS, type Product, type Unit } from "../../core/types";
import { confirmDialog } from "../components/modal";
import { iconFor } from "../icons";
import { scanBarcode } from "../scanner";
import { parseCsvLine, parseSpreadsheetRows } from "./csv";
import { downloadText } from "./download";
import type { TabModule } from "./tab-module";

export const productosTab: TabModule = {
  id: "productos",
  render(root, ctx) {
    setHtml(
      root,
      html`
        <div class="split">
          <article class="card">
            <h2>Alta / edición de producto</h2>
            <p class="hint" id="stockScopeHint"></p>
            <div class="actions wrap-actions">
              <button id="downloadTemplate" class="ghost" type="button">Descargar plantilla Excel</button>
              <label class="import-label">Importar productos
                <input id="importProducts" type="file" accept=".csv,.xls,text/csv,application/vnd.ms-excel">
              </label>
            </div>
            <form id="productForm" class="form">
              <input type="hidden" id="productId">
              <input id="productName" class="input" placeholder="Nombre" required>
              <div class="row">
                <input id="productCategory" class="input" placeholder="Categoría" value="Abarrotes">
                <select id="productUnit" class="input">
                  ${UNITS.map((unit) => html`<option value="${unit}">${unit}</option>`)}
                </select>
              </div>
              <div class="row">
                <input id="productCost" class="input" type="number" step="0.01" min="0" placeholder="Costo">
                <input id="productPrice" class="input" type="number" step="0.01" min="0" placeholder="Precio venta" required>
              </div>
              <div class="search-row">
                <label class="form-field">Código de barras (opcional)
                  <input id="productBarcode" class="input" inputmode="numeric">
                </label>
                <button id="barcodeScan" class="ghost" type="button" style="align-self: end;">${iconFor("barcode")} Escanear</button>
              </div>
              <div class="row">
                <input id="productStock" class="input" type="number" step="0.01" placeholder="Existencia (sucursal actual)" required>
                <input id="productMin" class="input" type="number" step="0.01" placeholder="Mínimo" value="2">
              </div>
              <div class="actions">
                <button class="primary" type="submit">Guardar producto</button>
                <button class="ghost" type="button" id="productCancel" hidden>Cancelar edición</button>
              </div>
            </form>
          </article>
          <article class="card">
            <h2>Productos registrados</h2>
            <div id="productsList" class="list"></div>
          </article>
        </div>
      `
    );

    const form = root.querySelector<HTMLFormElement>("#productForm")!;
    const idInput = root.querySelector<HTMLInputElement>("#productId")!;
    const nameInput = root.querySelector<HTMLInputElement>("#productName")!;
    const categoryInput = root.querySelector<HTMLInputElement>("#productCategory")!;
    const unitInput = root.querySelector<HTMLSelectElement>("#productUnit")!;
    const costInput = root.querySelector<HTMLInputElement>("#productCost")!;
    const priceInput = root.querySelector<HTMLInputElement>("#productPrice")!;
    const stockInput = root.querySelector<HTMLInputElement>("#productStock")!;
    const minInput = root.querySelector<HTMLInputElement>("#productMin")!;
    const barcodeInput = root.querySelector<HTMLInputElement>("#productBarcode")!;
    const cancelEdit = root.querySelector<HTMLButtonElement>("#productCancel")!;
    const list = root.querySelector<HTMLElement>("#productsList")!;
    const hint = root.querySelector<HTMLElement>("#stockScopeHint")!;

    const stockRowFor = (productId: string) =>
      ctx.repos.stocks.all().find(
        (row) => !row.deleted && row.product_id === productId && row.branch_id === ctx.branches.operationalId()
      );

    const resetForm = (): void => {
      form.reset();
      idInput.value = "";
      cancelEdit.hidden = true;
      minInput.value = "2";
    };

    // Escanear código directamente al formulario
    const barcodeScanButton = root.querySelector<HTMLButtonElement>("#barcodeScan")!;
    barcodeScanButton.addEventListener("click", async () => {
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
      const products = [...ctx.repos.products.list()].sort((a, b) => a.name.localeCompare(b.name));
      if (!products.length) {
        setHtml(list, html`<p class="muted">Aún no hay productos.</p>`);
        return;
      }
      setHtml(
        list,
        html`${products.map((product) => {
          const stock = stockRowFor(product.id);
          const low = (stock?.stock ?? 0) <= (stock?.min_stock ?? 0);
          return html`
            <div class="list-item ${low ? "low" : ""} ${product.active === false ? "inactive" : ""}">
              <div class="item-line"><strong>${product.name}</strong><strong>${fmtMoneyPesos(product.price)}</strong></div>
              <p class="muted">
                ${product.category || "Sin categoría"} | UM ${product.um} | Costo ${fmtMoneyPesos(product.cost)}
                | Stock ${stock ? fmtQtySafe(stock.stock) : "—"} ${product.um} | Mín ${stock ? fmtQtySafe(stock.min_stock) : "—"}
                ${product.active === false ? " | OCULTO" : ""}
              </p>
              <div class="actions">
                <button class="ghost" type="button" data-edit="${product.id}">Editar</button>
                <button class="ghost danger" type="button" data-hide="${product.id}">${product.active === false ? "Mostrar" : "Ocultar"}</button>
                <button class="ghost danger" type="button" data-delete="${product.id}">Eliminar</button>
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
      const product: Product = {
        id,
        name: nameInput.value.trim(),
        category: categoryInput.value.trim(),
        um: (unitInput.value as Unit) ?? "Pza",
        cost: Number(costInput.value || 0),
        price: Number(priceInput.value || 0),
        barcode: barcodeInput.value.trim() || undefined,
        active: existing?.active !== false,
        created_at: existing?.created_at ?? ts,
        updated_at: ts
      };
      ctx.repos.products.upsert(product);
      const stockId = `${id}:${ctx.branches.operationalId()}`;
      ctx.repos.stocks.upsert({
        id: stockId,
        product_id: id,
        branch_id: ctx.branches.operationalId(),
        stock: normalizeQty(stockInput.value),
        min_stock: normalizeQty(minInput.value),
        updated_at: ts
      });
      resetForm();
      ctx.toast("Producto guardado");
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
        categoryInput.value = product.category ?? "";
        unitInput.value = product.um;
        costInput.value = String(product.cost ?? 0);
        priceInput.value = String(product.price ?? 0);
        const stock = stockRowFor(product.id);
        stockInput.value = String(stock?.stock ?? 0);
        minInput.value = String(stock?.min_stock ?? 0);
        barcodeInput.value = product.barcode ?? "";
        cancelEdit.hidden = false;
        nameInput.focus();
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
        ctx.toast("Producto eliminado");
      }
    });

    root.querySelector<HTMLButtonElement>("#downloadTemplate")!.addEventListener("click", () => {
      const rows = [
        ["nombre", "categoria", "um", "costo", "precio", "existencia", "minimo"],
        ["Coca Cola 600 ml", "Refrescos", "Pza", "13", "18", "12", "4"],
        ["Azúcar", "Abarrotes", "Kg", "22", "30", "25.500", "5"],
        ["Arroz", "Abarrotes", "Kg", "24", "34", "18.250", "4"]
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
        const [name, category, third, fourth, fifth, sixth, seventh] = row;
        if (!name?.trim()) continue;
        const hasUnit = UNITS.some((unit) => unit.toLowerCase() === (third ?? "").trim().toLowerCase());
        const um = (hasUnit ? (third as Unit) : "Pza") ?? "Pza";
        const cost = Number((hasUnit ? fourth : third) || 0);
        const price = Number((hasUnit ? fifth : fourth) || 0);
        const stock = normalizeQty(hasUnit ? sixth : fifth);
        const minStock = normalizeQty(hasUnit ? seventh : sixth);
        const cleanName = name.trim();
        const existing = ctx.repos.products.list().find((p) => p.name.toLowerCase() === cleanName.toLowerCase());
        const product: Product = {
          id: existing?.id ?? uid(),
          name: cleanName,
          category: (category ?? "Abarrotes").trim(),
          um,
          cost,
          price,
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

    ctx.store.watch(
      (s) => [s.products, s.product_stocks, s.branches, s.currentBranchId] as const,
      render
    );
    render();
  }
};

function fmtQtySafe(value: number | undefined): string {
  return normalizeQty(value ?? 0).toLocaleString("es-MX", { maximumFractionDigits: 3 });
}
