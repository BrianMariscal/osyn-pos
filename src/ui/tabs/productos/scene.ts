import { html, setHtml, type SafeHtml } from "../../../core/html";
import { normalizeQty } from "../../../core/qty";
import { SALE_GROUP_LABELS, SALE_GROUPS, UNITS, type ProductStock } from "../../../core/types";
import { categoryFieldMarkup } from "../../category-field";
import { productFiltersMarkup } from "../../product-filters";
import { iconFor } from "../../icons";
import { scanButtonMarkup } from "../../scan-field";
import { mountSections, type Sections } from "../../sections";
import type { AppContext } from "../../context";

/** Base compartida de la pestaña Productos: markup, secciones y existencias. */
export interface ProductosScene {
  ctx: AppContext;
  root: HTMLElement;
  sections: Sections;
  stockRowFor(productId: string): ProductStock | undefined;
}

export function createProductosScene(root: HTMLElement, ctx: AppContext): ProductosScene {
  setHtml(root, productosMarkup());

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

  const stockRowFor = (productId: string) =>
    ctx.repos.stocks.all().find(
      (row) => !row.deleted && row.product_id === productId && row.branch_id === ctx.branches.operationalId()
    );

  return { ctx, root, sections, stockRowFor };
}

/** Existencia con hasta 3 decimales (sin ceros de sobra). */
export function fmtQtySafe(value: number | undefined): string {
  return normalizeQty(value ?? 0).toLocaleString("es-MX", { maximumFractionDigits: 3 });
}

/** HTML de Productos: lista a la izquierda, formulario y respaldo a la derecha. */
function productosMarkup(): SafeHtml {
  return html`
    <div class="split">
      <article class="card">
        <div class="section-title">
          <h2>Productos <span class="count-badge" data-tone="blue" id="productsTotal"></span></h2>
          <button id="newProductToggle" class="primary" type="button">${iconFor("plus")} Nuevo</button>
        </div>
        <div class="search-row">
          <input id="productsSearch" class="input" type="search" placeholder="Buscar por nombre o código de barras" autocomplete="off">
          ${scanButtonMarkup("productsScan")}
        </div>
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
            <label class="form-field">Costo <span id="productCostUnit" class="muted"></span>
              <input id="productCost" class="input" type="number" step="0.01" min="0" inputmode="decimal" placeholder="0.00">
            </label>
            <label class="form-field">Precio de venta <span id="productPriceUnit" class="muted"></span>
              <input id="productPrice" class="input" type="number" step="0.01" min="0.01" inputmode="decimal" placeholder="0.00" required>
            </label>
          </div>
          <p id="productPriceHint" class="hint hidden">Con la unidad Gr el precio se cobra POR GRAMO. Si cobras por kilo, usa la unidad Kg.</p>
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
  `;
}
