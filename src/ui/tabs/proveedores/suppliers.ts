import { nowISO } from "../../../core/dates";
import { html, setHtml } from "../../../core/html";
import { uid } from "../../../core/id";
import type { Supplier } from "../../../core/types";
import { nextSupplierNumber, plainText, searchProducts, supplierCode, supplierLabel } from "../../../domain/catalog";
import { openModal } from "../../components/modal";
import { iconFor } from "../../icons";
import { paginate, pagerMarkup } from "../../pager";
import { openNewProductModal } from "../inventario";
import { CENTRAL_ID, type ProveedoresScene } from "./scene";

export function renderSuppliers(scene: ProveedoresScene): void {
  const { ui, state, canManage, sortedSuppliers, productCount } = scene;
  ui.addSupplierButton.hidden = !canManage();
  const suppliers = sortedSuppliers();
  const selected = ui.purchaseSupplier.value;
  setHtml(
    ui.purchaseSupplier,
    html`<option value="">Elige proveedor…</option>
      <option value="${CENTRAL_ID}" ${selected === CENTRAL_ID ? "selected" : null}>Central de Abastos (compra local)</option>${suppliers.map(
      (supplier) => html`<option value="${supplier.id}" ${supplier.id === selected ? "selected" : null}>${supplierLabel(supplier)}</option>`
    )}`
  );
  ui.suppliersCount.textContent = suppliers.length ? String(suppliers.length) : "";
  ui.supplierSearch.classList.toggle("hidden", suppliers.length < 6);
  if (!suppliers.length) {
    setHtml(ui.suppliersList, html`<p class="muted">Agrega tu primer proveedor: una distribuidora, la tienda de la esquina…</p>`);
    return;
  }
  const q = plainText(ui.supplierSearch.value);
  const byNumber = /^#?(\d+)$/.exec(q);
  const matches = suppliers.filter((supplier) =>
    !q ||
    (byNumber ? Number(supplier.number) === Number(byNumber[1]) : q.split(/\s+/).every((word) => plainText(`${supplier.name} ${supplier.type ?? ""} ${supplier.phone}`).includes(word)))
  );
  const page = paginate(matches, state.supplierPage, 8);
  const shown = page.items;
  setHtml(
    ui.suppliersList,
    matches.length
      ? html`${shown.map((supplier) => {
          const count = productCount(supplier.id);
          return html`
            <details class="row-item" data-supplier="${supplier.id}" ${state.openSuppliers.has(supplier.id) ? "open" : null}>
              <summary>
                ${supplierCode(supplier) ? html`<span class="supplier-num">${supplierCode(supplier)}</span>` : html``}
                <span class="row-title"><strong>${supplier.name}</strong><small class="muted">${supplier.type || "Sin giro"}</small></span>
                <span class="tag">${count} ${count === 1 ? "producto" : "productos"}</span>
              </summary>
              <div class="row-body">
                <p class="muted">${supplier.phone ? html`Tel. <a href="tel:${supplier.phone}">${supplier.phone}</a>` : "Sin teléfono"}${supplier.notes ? ` · ${supplier.notes}` : ""}</p>
                <div class="actions">
                  <button class="ghost" type="button" data-products-supplier="${supplier.id}">${iconFor("box")} Productos</button>
                  ${canManage()
                    ? html`<button class="ghost" type="button" data-edit-supplier="${supplier.id}">${iconFor("edit")} Editar</button>
                        <button class="ghost danger" type="button" data-delete-supplier="${supplier.id}">${iconFor("trash")} Eliminar</button>`
                    : html``}
                </div>
              </div>
            </details>
          `;
        })}
        ${pagerMarkup("suppliers", page)}`
      : html`<p class="muted">Ningún proveedor coincide.</p>`
  );
}

export function openSupplierForm(scene: ProveedoresScene, supplier?: Supplier): void {
  const { ctx } = scene;
  openModal({
    title: supplier ? `Editar proveedor ${supplierCode(supplier)}` : "Nuevo proveedor",
    content: html`
      ${supplier ? html`` : html`<p class="muted">Se le asignará el número ${supplierCode({ number: nextSupplierNumber(ctx.repos.suppliers.all()) })}.</p>`}
      <label class="form-field">Nombre
        <input id="sName" class="input" value="${supplier?.name ?? ""}" required>
      </label>
      <label class="form-field">Giro / tipo de productos
        <input id="sType" class="input" value="${supplier?.type ?? ""}" placeholder="Refrescos, cerveza, cigarros, abarrotes…" list="supplierTypes">
        <datalist id="supplierTypes">
          ${["Abarrotes", "Refrescos", "Cerveza", "Cigarros", "Lácteos", "Botanas", "Pan", "Limpieza", "Frutas y verduras"].map((type) => html`<option value="${type}"></option>`)}
        </datalist>
      </label>
      <label class="form-field">Teléfono
        <input id="sPhone" class="input" type="tel" value="${supplier?.phone ?? ""}">
      </label>
      <label class="form-field">Nota
        <input id="sNotes" class="input" value="${supplier?.notes ?? ""}" placeholder="Días de visita, condiciones…">
      </label>
    `,
    actions: [
      { label: "Cancelar", kind: "ghost", onClick: (close) => close() },
      {
        label: supplier ? "Guardar" : "Crear",
        kind: "primary",
        onClick: (close) => {
          const value = (id: string): string => (document.getElementById(id) as HTMLInputElement).value.trim();
          const name = value("sName");
          if (!name) {
            ctx.toast("Escribe el nombre del proveedor");
            return;
          }
          const ts = nowISO();
          const fields = { name, type: value("sType"), phone: value("sPhone"), notes: value("sNotes") };
          if (supplier) {
            ctx.repos.suppliers.upsert({ ...supplier, ...fields, updated_at: ts });
            ctx.toast("Proveedor actualizado");
          } else {
            const number = nextSupplierNumber(ctx.repos.suppliers.all());
            ctx.repos.suppliers.upsert({ id: uid(), number, ...fields, created_at: ts, updated_at: ts });
            ctx.toast(`Proveedor ${supplierCode({ number })} agregado`);
          }
          close();
        }
      }
    ]
  });
}

/** Productos que surte el proveedor: se asocian/desasocian con casillas. */
export function openSupplierProducts(scene: ProveedoresScene, supplier: Supplier): void {
  const { ctx, canManage } = scene;
  const editable = canManage();
  const all = ctx.repos.products.list().filter((product) => product.active !== false).sort((a, b) => a.name.localeCompare(b.name));
  const selected = new Set(all.filter((product) => product.supplier_id === supplier.id).map((product) => product.id));
  const renderRows = (listEl: HTMLElement, query: string): void => {
    const rows = searchProducts(all, query).filter((product) => editable || selected.has(product.id));
    setHtml(
      listEl,
      rows.length
        ? html`${rows.map((product) => {
            const other = product.supplier_id && product.supplier_id !== supplier.id ? ctx.repos.suppliers.byId(product.supplier_id) : undefined;
            return html`
              <label class="check-option check-row">
                <input type="checkbox" name="producto" value="${product.id}" ${selected.has(product.id) ? "checked" : null} ${editable ? null : "disabled"}>
                <span>${product.name}<small class="muted">${product.category || "Sin categoría"}${other && !other.deleted ? ` · ahora con ${supplierLabel(other)}` : ""}</small></span>
              </label>
            `;
          })}`
        : html`<p class="muted">${editable ? "No hay productos con esa búsqueda." : "Este proveedor aún no tiene productos asociados."}</p>`
    );
  };
  openModal({
    title: `Productos de ${supplierLabel(supplier)}`,
    content: html`
      <p class="muted">${editable ? "Marca los productos que surte este proveedor. En Venta y en Compras podrás filtrarlos por proveedor." : "Productos que surte este proveedor."}</p>
      <input id="spSearch" class="input" type="search" placeholder="Buscar producto o código" autocomplete="off">
      <div id="spList" class="check-list"></div>
      ${editable ? html`<button id="spNew" class="ghost" type="button">${iconFor("plus")} Crear producto nuevo para este proveedor</button>` : html``}
    `,
    actions: editable
      ? [
          { label: "Cancelar", kind: "ghost", onClick: (close) => close() },
          {
            label: "Guardar",
            kind: "primary",
            onClick: (close) => {
              const ts = nowISO();
              let changed = 0;
              for (const product of all) {
                const current = ctx.repos.products.byId(product.id);
                if (!current || current.deleted) continue;
                const linked = current.supplier_id === supplier.id;
                if (selected.has(product.id) && !linked) {
                  ctx.repos.products.upsert({ ...current, supplier_id: supplier.id, updated_at: ts });
                  changed += 1;
                } else if (!selected.has(product.id) && linked) {
                  ctx.repos.products.upsert({ ...current, supplier_id: undefined, updated_at: ts });
                  changed += 1;
                }
              }
              close();
              ctx.toast(changed ? `${changed} productos actualizados` : "Sin cambios");
            }
          }
        ]
      : [{ label: "Cerrar", kind: "primary" }],
    onOpen: (modalRoot, close) => {
      const listEl = modalRoot.querySelector<HTMLElement>("#spList")!;
      const searchEl = modalRoot.querySelector<HTMLInputElement>("#spSearch")!;
      renderRows(listEl, "");
      searchEl.addEventListener("input", () => renderRows(listEl, searchEl.value));
      listEl.addEventListener("change", (event) => {
        const box = event.target as HTMLInputElement;
        if (box.type !== "checkbox") return;
        if (box.checked) selected.add(box.value);
        else selected.delete(box.value);
      });
      modalRoot.querySelector<HTMLButtonElement>("#spNew")?.addEventListener("click", () => {
        close();
        openNewProductModal(ctx, () => undefined, { supplierId: supplier.id });
      });
    }
  });
}
