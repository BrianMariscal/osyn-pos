import { html, setHtml } from "../../core/html";
import { fmtDateTime, nowISO } from "../../core/dates";
import { uid } from "../../core/id";
import { fmtMoneyPesos } from "../../core/money";
import { fmtQty } from "../../core/qty";
import type { Supplier } from "../../core/types";
import { assignMissingSupplierNumbers, nextSupplierNumber, plainText, searchProducts, supplierCode, supplierLabel } from "../../domain/catalog";
import { confirmDialog, openModal } from "../components/modal";
import { iconFor } from "../icons";
import { mountPurchaseLines } from "../purchase-lines";
import { openNewProductModal } from "./inventario";
import { exportSuppliers, importSuppliers } from "../product-transfer-ui";
import type { TabModule } from "./tab-module";

const CENTRAL_ID = "__central__";
const CENTRAL_NAME = "Central de Abastos";

export const proveedoresTab: TabModule = {
  id: "proveedores",
  render(root, ctx) {
    setHtml(
      root,
      html`
        <div class="split">
          <article class="card">
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

            <div class="section-title section-gap">
              <h2>Compras registradas</h2>
              <span class="hint" id="purchasesCount"></span>
            </div>
            <div id="purchasesList" class="list"></div>
          </article>

          <article class="card">
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
      `
    );

    const addSupplierButton = root.querySelector<HTMLButtonElement>("#addSupplier")!;
    const suppliersList = root.querySelector<HTMLElement>("#suppliersList")!;
    const purchaseForm = root.querySelector<HTMLFormElement>("#purchaseForm")!;
    const purchaseSupplier = root.querySelector<HTMLSelectElement>("#purchaseSupplier")!;
    const purchasePaidFrom = root.querySelector<HTMLSelectElement>("#purchasePaidFrom")!;
    const purchaseLinesEl = root.querySelector<HTMLElement>("#purchaseLines")!;
    const list = root.querySelector<HTMLElement>("#purchasesList")!;
    const supplierSearch = root.querySelector<HTMLInputElement>("#supplierSearch")!;
    const suppliersCount = root.querySelector<HTMLElement>("#suppliersCount")!;
    const purchasesCount = root.querySelector<HTMLElement>("#purchasesCount")!;
    /** Proveedores expandidos (se conservan al redibujar por sync). */
    const openSuppliers = new Set<string>();
    const PAGE = 15;
    let supplierLimit = PAGE;
    let purchaseLimit = 10;

    // "Central de Abastos" no es un proveedor del catálogo: compra local en
    // varios puestos, normalmente con dinero aparte. Ofrece todos los productos.
    const lines = mountPurchaseLines(purchaseLinesEl, ctx, {
      requireTotal: true,
      supplierId: () => (purchaseSupplier.value === CENTRAL_ID ? "" : purchaseSupplier.value)
    });
    // Solo dueño/administrador editan el catálogo (así lo exige la base de datos).
    const canManage = (): boolean => ctx.auth.isAdmin();

    root.querySelector<HTMLButtonElement>("#downloadSuppliersXls")!.addEventListener("click", () => exportSuppliers(ctx, "xls"));
    root.querySelector<HTMLElement>("#importSuppliersLabel")!.hidden = !canManage();
    root.querySelector<HTMLInputElement>("#importSuppliers")!.addEventListener("change", async (event) => {
      const input = event.target as HTMLInputElement;
      const file = input.files?.[0];
      if (!file) return;
      await importSuppliers(ctx, file);
      input.value = "";
    });

    const sortedSuppliers = (): Supplier[] =>
      ctx.repos.suppliers.list().sort((a, b) => (a.number ?? 0) - (b.number ?? 0) || a.name.localeCompare(b.name));

    const productCount = (supplierId: string): number =>
      ctx.repos.products.list().filter((product) => product.supplier_id === supplierId).length;

    const renderSuppliers = (): void => {
      addSupplierButton.hidden = !canManage();
      const suppliers = sortedSuppliers();
      const selected = purchaseSupplier.value;
      setHtml(
        purchaseSupplier,
        html`<option value="">Elige proveedor…</option>
          <option value="${CENTRAL_ID}" ${selected === CENTRAL_ID ? "selected" : null}>Central de Abastos (compra local)</option>${suppliers.map(
          (supplier) => html`<option value="${supplier.id}" ${supplier.id === selected ? "selected" : null}>${supplierLabel(supplier)}</option>`
        )}`
      );
      suppliersCount.textContent = suppliers.length ? String(suppliers.length) : "";
      supplierSearch.classList.toggle("hidden", suppliers.length < 6);
      if (!suppliers.length) {
        setHtml(suppliersList, html`<p class="muted">Agrega tu primer proveedor: una distribuidora, la tienda de la esquina…</p>`);
        return;
      }
      const q = plainText(supplierSearch.value);
      const byNumber = /^#?(\d+)$/.exec(q);
      const matches = suppliers.filter((supplier) =>
        !q ||
        (byNumber ? Number(supplier.number) === Number(byNumber[1]) : q.split(/\s+/).every((word) => plainText(`${supplier.name} ${supplier.type ?? ""} ${supplier.phone}`).includes(word)))
      );
      const shown = matches.slice(0, supplierLimit);
      setHtml(
        suppliersList,
        matches.length
          ? html`${shown.map((supplier) => {
              const count = productCount(supplier.id);
              return html`
                <details class="row-item" data-supplier="${supplier.id}" ${openSuppliers.has(supplier.id) ? "open" : null}>
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
            ${matches.length > shown.length
              ? html`<button class="ghost block list-more" type="button" data-more-suppliers>Ver más (${matches.length - shown.length})</button>`
              : html``}`
          : html`<p class="muted">Ningún proveedor coincide.</p>`
      );
    };

    const openSupplierForm = (supplier?: Supplier): void => {
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
    };

    /** Productos que surte el proveedor: se asocian/desasocian con casillas. */
    const openSupplierProducts = (supplier: Supplier): void => {
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
                    <input type="checkbox" value="${product.id}" ${selected.has(product.id) ? "checked" : null} ${editable ? null : "disabled"}>
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
    };

    addSupplierButton.addEventListener("click", () => openSupplierForm());

    suppliersList.addEventListener("click", async (event) => {
      const target = event.target as HTMLElement;
      if (target.closest("[data-more-suppliers]")) {
        supplierLimit += PAGE;
        renderSuppliers();
        return;
      }
      const productsButton = target.closest<HTMLElement>("[data-products-supplier]");
      if (productsButton) {
        const supplier = ctx.repos.suppliers.byId(productsButton.dataset.productsSupplier!);
        if (supplier) openSupplierProducts(supplier);
        return;
      }
      const editButton = target.closest<HTMLElement>("[data-edit-supplier]");
      if (editButton) {
        const supplier = ctx.repos.suppliers.byId(editButton.dataset.editSupplier!);
        if (supplier) openSupplierForm(supplier);
        return;
      }
      const deleteButton = target.closest<HTMLElement>("[data-delete-supplier]");
      if (deleteButton) {
        const supplier = ctx.repos.suppliers.byId(deleteButton.dataset.deleteSupplier!);
        if (!supplier) return;
        const count = productCount(supplier.id);
        const confirmed = await confirmDialog({
          title: "Eliminar proveedor",
          message: `Se eliminará "${supplier.name}" del catálogo.${count ? ` Sus ${count} productos quedarán sin proveedor.` : ""} Las compras pasadas no se afectan.`,
          confirmLabel: "Eliminar",
          danger: true
        });
        if (!confirmed) return;
        const ts = nowISO();
        ctx.repos.products
          .list()
          .filter((product) => product.supplier_id === supplier.id)
          .forEach((product) => ctx.repos.products.upsert({ ...product, supplier_id: undefined, updated_at: ts }));
        ctx.repos.suppliers.softDelete(supplier.id);
        ctx.toast("Proveedor eliminado");
      }
    });

    const renderPurchases = (): void => {
      const branchId = ctx.branches.operationalId();
      const purchases = ctx.repos.purchases
        .list()
        .filter((purchase) => purchase.branch_id === branchId)
        .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at));
      purchasesCount.textContent = purchases.length ? `${purchases.length} en esta sucursal` : "";
      setHtml(
        list,
        purchases.length
          ? html`${purchases.slice(0, purchaseLimit).map(
              (purchase) => html`
                <div class="list-item">
                  <div class="item-line">
                    <strong>${purchase.supplier}</strong>
                    <strong>${fmtMoneyPesos(purchase.total)}</strong>
                  </div>
                  ${purchase.paid_from === "aparte" ? html`<span class="tag">Pagada aparte</span>` : html``}
                  <p class="muted">${purchase.product_name} | ${fmtQty(purchase.qty)} ${purchase.um ?? "Pza"}${purchase.packs ? ` (${fmtQty(purchase.packs)} ${purchase.packs === 1 ? "caja" : "cajas"} de ${fmtQty(purchase.pack_size ?? 0)})` : ""} | ${fmtDateTime(purchase.created_at)}</p>
                </div>
              `
            )}${purchases.length > purchaseLimit
              ? html`<button class="ghost block list-more" type="button" data-more-purchases>Ver más (${purchases.length - purchaseLimit})</button>`
              : html``}`
          : html`<p class="muted">Sin compras registradas.</p>`
      );
    };

    list.addEventListener("click", (event) => {
      if (!(event.target as HTMLElement).closest("[data-more-purchases]")) return;
      purchaseLimit += 20;
      renderPurchases();
    });
    supplierSearch.addEventListener("input", () => {
      supplierLimit = PAGE;
      renderSuppliers();
    });
    // Recuerda qué proveedores están abiertos para no cerrarlos al sincronizar
    suppliersList.addEventListener("toggle", (event) => {
      const row = event.target as HTMLDetailsElement;
      const id = row.dataset?.supplier;
      if (!id) return;
      if (row.open) openSuppliers.add(id);
      else openSuppliers.delete(id);
    }, true);

    root.querySelector<HTMLButtonElement>("#addPurchaseLine")!.addEventListener("click", () => lines.addLine());
    purchaseSupplier.addEventListener("change", () => {
      // La Central de Abastos casi siempre se paga con dinero aparte.
      purchasePaidFrom.value = purchaseSupplier.value === CENTRAL_ID ? "aparte" : "caja";
      lines.render();
    });

    purchaseForm.addEventListener("submit", (event) => {
      event.preventDefault();
      const central = purchaseSupplier.value === CENTRAL_ID;
      const supplier = central ? undefined : ctx.repos.suppliers.byId(purchaseSupplier.value);
      if (!central && (!supplier || supplier.deleted)) {
        ctx.toast("Elige el proveedor de la compra");
        return;
      }
      const read = lines.read();
      if (!read.ok) {
        ctx.toast(read.error);
        return;
      }
      const paidFrom = purchasePaidFrom.value === "aparte" ? "aparte" : "caja";
      const result = ctx.inventory.receiveStockMany(read.items, supplier?.name ?? CENTRAL_NAME, paidFrom);
      if (!result.ok) {
        ctx.toast(result.error);
        return;
      }
      lines.reset();
      ctx.toast(`Compra registrada: ${result.count} productos, ${fmtQty(result.qty)} unidades`);
    });

    ctx.store.watch((s) => s.suppliers, (suppliers) => {
      // Proveedores dados de alta antes de la numeración: se numeran una vez.
      if (canManage()) {
        const numbered = assignMissingSupplierNumbers(suppliers);
        if (numbered.length) {
          ctx.repos.suppliers.upsertMany(numbered.map((s) => ({ ...s, updated_at: nowISO() })));
          return;
        }
      }
      renderSuppliers();
      lines.render();
    });
    ctx.store.watch((s) => s.products, () => {
      renderSuppliers();
      lines.render();
    });
    ctx.store.watch((s) => [s.purchases, s.branches, s.currentBranchId] as const, renderPurchases);
  }
};
