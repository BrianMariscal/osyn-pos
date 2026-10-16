import { html, setHtml, type SafeHtml } from "../../../core/html";
import type { Supplier } from "../../../core/types";
import type { AppContext } from "../../context";
import { iconFor } from "../../icons";
import { mountPurchaseLines, type PurchaseLines } from "../../purchase-lines";
import { mountSections } from "../../sections";

export const CENTRAL_ID = "__central__";
export const CENTRAL_NAME = "Central de Abastos";

/** Referencias de proveedores (una por sección del markup). */
export interface ProveedoresRefs {
  addSupplierButton: HTMLButtonElement;
  suppliersList: HTMLElement;
  purchaseForm: HTMLFormElement;
  purchaseSupplier: HTMLSelectElement;
  purchasePaidFrom: HTMLSelectElement;
  purchaseLinesEl: HTMLElement;
  list: HTMLElement;
  supplierSearch: HTMLInputElement;
  suppliersCount: HTMLElement;
  purchasesCount: HTMLElement;
}

/** Base compartida de proveedores: markup, referencias y estado de listas. */
export interface ProveedoresScene {
  ctx: AppContext;
  root: HTMLElement;
  ui: ProveedoresRefs;
  state: { supplierPage: number; purchasePage: number; openSuppliers: Set<string> };
  lines: PurchaseLines;
  canManage(): boolean;
  sortedSuppliers(): Supplier[];
  productCount(supplierId: string): number;
}

export function createProveedoresScene(root: HTMLElement, ctx: AppContext): ProveedoresScene {
  setHtml(root, proveedoresMarkup());
  const ui = collectRefs(root);
  mountSections(
    root,
    [
      { id: "compra", label: "Registrar compra", el: root.querySelector<HTMLElement>("#supPurchase") },
      { id: "proveedores", label: "Proveedores", el: root.querySelector<HTMLElement>("#supDirectory") },
      { id: "compras", label: "Compras", el: root.querySelector<HTMLElement>("#supHistory") }
    ],
    { always: true }
  );

  // "Central de Abastos" no es un proveedor del catálogo: compra local en
  // varios puestos, normalmente con dinero aparte. Ofrece todos los productos.
  const lines = mountPurchaseLines(ui.purchaseLinesEl, ctx, {
    requireTotal: true,
    supplierId: () => (ui.purchaseSupplier.value === CENTRAL_ID ? "" : ui.purchaseSupplier.value)
  });
  // Solo dueño/administrador editan el catálogo (así lo exige la base de datos).
  const canManage = (): boolean => ctx.auth.isAdmin();
  const sortedSuppliers = (): Supplier[] =>
    ctx.repos.suppliers.list().sort((a, b) => (a.number ?? 0) - (b.number ?? 0) || a.name.localeCompare(b.name));
  const productCount = (supplierId: string): number =>
    ctx.repos.products.list().filter((product) => product.supplier_id === supplierId).length;

  return {
    ctx,
    root,
    ui,
    state: { supplierPage: 0, purchasePage: 0, openSuppliers: new Set<string>() },
    lines,
    canManage,
    sortedSuppliers,
    productCount
  };
}

function proveedoresMarkup(): SafeHtml {
  return html`
    <div class="split">
      <article class="card" id="supPurchase">
        <h2>Registrar compra</h2>
        <form id="purchaseForm" class="form">
          <div class="row">
            <label class="form-field">Proveedor
              <select id="purchaseSupplier" class="input"></select>
            </label>
            <label class="form-field">¿Con qué se pagó?
              <select id="purchasePaidFrom" class="input">
                <option value="caja">Dinero de la caja (se resta en el corte)</option>
                <option value="aparte">Dinero aparte (no sale de la caja)</option>
              </select>
            </label>
          </div>
          <div class="section-title"><h3>Productos de la compra</h3><button id="addPurchaseLine" class="ghost" type="button">${iconFor("plus")} Agregar producto</button></div>
          <div id="purchaseLines" class="purchase-lines"></div>
          <button class="primary" type="submit">Registrar compra completa</button>
        </form>
      </article>

      <article class="card" id="supHistory">
        <div class="section-title">
          <h2>Compras registradas</h2>
          <span class="hint" id="purchasesCount"></span>
        </div>
        <div id="purchasesList" class="list"></div>
      </article>

      <article class="card" id="supDirectory">
        <div class="section-title">
          <h2>Proveedores <span class="count-badge" data-tone="violet" id="suppliersCount"></span></h2>
          <button id="addSupplier" class="primary" type="button">${iconFor("plus")} Agregar</button>
        </div>
        <p class="hint">Cada proveedor recibe un número automático. Toca uno para ver sus datos, productos y opciones.</p>
        <input id="supplierSearch" class="input" type="search" placeholder="Buscar proveedor, giro o número (#3)" autocomplete="off">
        <div id="suppliersList" class="list collapsible-list"></div>
        <div class="actions wrap-actions">
          <button id="downloadSuppliersXls" class="ghost" type="button">${iconFor("download")} Descargar Excel</button>
          <label class="import-label" id="importSuppliersLabel">${iconFor("upload")} Importar
            <input id="importSuppliers" type="file" accept=".csv,.xls,.xml,.txt,text/csv,application/vnd.ms-excel">
          </label>
        </div>
      </article>
    </div>
  `;
}

function collectRefs(root: HTMLElement): ProveedoresRefs {
  return {
    addSupplierButton: root.querySelector<HTMLButtonElement>("#addSupplier")!,
    suppliersList: root.querySelector<HTMLElement>("#suppliersList")!,
    purchaseForm: root.querySelector<HTMLFormElement>("#purchaseForm")!,
    purchaseSupplier: root.querySelector<HTMLSelectElement>("#purchaseSupplier")!,
    purchasePaidFrom: root.querySelector<HTMLSelectElement>("#purchasePaidFrom")!,
    purchaseLinesEl: root.querySelector<HTMLElement>("#purchaseLines")!,
    list: root.querySelector<HTMLElement>("#purchasesList")!,
    supplierSearch: root.querySelector<HTMLInputElement>("#supplierSearch")!,
    suppliersCount: root.querySelector<HTMLElement>("#suppliersCount")!,
    purchasesCount: root.querySelector<HTMLElement>("#purchasesCount")!
  };
}
