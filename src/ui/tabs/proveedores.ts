import { html, setHtml } from "../../core/html";
import { fmtDateTime, nowISO } from "../../core/dates";
import { uid } from "../../core/id";
import { fmtMoneyPesos } from "../../core/money";
import { fmtQty } from "../../core/qty";
import type { Supplier } from "../../core/types";
import { confirmDialog, openModal } from "../components/modal";
import { iconFor } from "../icons";
import type { TabModule } from "./tab-module";

export const proveedoresTab: TabModule = {
  id: "proveedores",
  render(root, ctx) {
    setHtml(
      root,
      html`
        <div class="split">
          <article class="card">
            <div class="section-title">
              <h2>Proveedores</h2>
              <button id="addSupplier" class="primary" type="button">${iconFor("plus")} Agregar</button>
            </div>
            <p class="hint">Tu catálogo: Central de Abastos, distribuidoras, etc. Se guarda para todas las sucursales.</p>
            <div id="suppliersList" class="list"></div>

            <h2>Registrar compra</h2>
            <form id="purchaseForm" class="form">
              <select id="purchaseSupplier" class="input" aria-label="Proveedor"></select>
              <div class="section-title"><h3>Productos de la compra</h3><button id="addPurchaseLine" class="ghost" type="button">+ Agregar producto</button></div>
              <div id="purchaseLines" class="form"></div>
              <button class="primary" type="submit">Registrar compra completa</button>
            </form>
          </article>

          <article class="card">
            <h2>Compras registradas</h2>
            <div id="purchasesList" class="list"></div>
          </article>
        </div>
      `
    );

    const addSupplierButton = root.querySelector<HTMLButtonElement>("#addSupplier")!;
    const suppliersList = root.querySelector<HTMLElement>("#suppliersList")!;
    const purchaseForm = root.querySelector<HTMLFormElement>("#purchaseForm")!;
    const purchaseSupplier = root.querySelector<HTMLSelectElement>("#purchaseSupplier")!;
    const purchaseLines = root.querySelector<HTMLElement>("#purchaseLines")!;
    const addPurchaseLine = root.querySelector<HTMLButtonElement>("#addPurchaseLine")!;
    const list = root.querySelector<HTMLElement>("#purchasesList")!;
    let cachedSuppliers: Supplier[] = [];

    const renderSuppliers = (): void => {
      cachedSuppliers = ctx.repos.suppliers.list().sort((a, b) => a.name.localeCompare(b.name));
      setHtml(
        purchaseSupplier,
        html`${cachedSuppliers.map((supplier) => html`<option value="${supplier.id}">${supplier.name}</option>`)}`
      );
      if (!cachedSuppliers.length) {
        setHtml(suppliersList, html`<p class="muted">Agrega tu primer proveedor: Central de Abastos, una distribuidora…</p>`);
        return;
      }
      setHtml(
        suppliersList,
        html`${cachedSuppliers.map(
          (supplier) => html`
            <div class="list-item item-line">
              <div>
                <strong>${supplier.name}</strong>
                <p class="muted">${supplier.phone || "Sin teléfono"}${supplier.notes ? ` · ${supplier.notes}` : ""}</p>
              </div>
              <div class="actions">
                <button class="ghost" type="button" data-edit-supplier="${supplier.id}">Editar</button>
                <button class="ghost danger" type="button" data-delete-supplier="${supplier.id}">Eliminar</button>
              </div>
            </div>
          `
        )}`
      );
    };

    const openSupplierForm = (supplier?: Supplier): void => {
      openModal({
        title: supplier ? "Editar proveedor" : "Nuevo proveedor",
        content: html`
          <label class="form-field">Nombre
            <input id="sName" class="input" value="${supplier?.name ?? ""}" required>
          </label>
          <label class="form-field">Teléfono
            <input id="sPhone" class="input" type="tel" value="${supplier?.phone ?? ""}">
          </label>
          <label class="form-field">Nota
            <input id="sNotes" class="input" value="${supplier?.notes ?? ""}" placeholder="Qué surte, días de visita…">
          </label>
        `,
        actions: [
          { label: "Cancelar", kind: "ghost", onClick: (close) => close() },
          {
            label: supplier ? "Guardar" : "Crear",
            kind: "primary",
            onClick: (close) => {
              const name = (document.getElementById("sName") as HTMLInputElement).value.trim();
              if (!name) {
                ctx.toast("Escribe el nombre del proveedor");
                return;
              }
              const ts = nowISO();
              const phone = (document.getElementById("sPhone") as HTMLInputElement).value.trim();
              const notes = (document.getElementById("sNotes") as HTMLInputElement).value.trim();
              if (supplier) {
                ctx.repos.suppliers.upsert({ ...supplier, name, phone, notes, updated_at: ts });
                ctx.toast("Proveedor actualizado");
              } else {
                ctx.repos.suppliers.upsert({ id: uid(), name, phone, notes, created_at: ts, updated_at: ts });
                ctx.toast("Proveedor agregado");
              }
              close();
              renderSuppliers();
            }
          }
        ]
      });
    };

    addSupplierButton.addEventListener("click", () => openSupplierForm());

    suppliersList.addEventListener("click", async (event) => {
      const target = event.target as HTMLElement;
      const editButton = target.closest<HTMLElement>("[data-edit-supplier]");
      if (editButton) {
        const supplier = cachedSuppliers.find((s) => s.id === editButton.dataset.editSupplier);
        if (supplier) openSupplierForm(supplier);
        return;
      }
      const deleteButton = target.closest<HTMLElement>("[data-delete-supplier]");
      if (deleteButton) {
        const supplier = cachedSuppliers.find((s) => s.id === deleteButton.dataset.deleteSupplier);
        if (!supplier) return;
        const confirmed = await confirmDialog({
          title: "Eliminar proveedor",
          message: `Se eliminará "${supplier.name}" del catálogo. Las compras pasadas no se afectan.`,
          confirmLabel: "Eliminar",
          danger: true
        });
        if (!confirmed) return;
        ctx.repos.suppliers.softDelete(supplier.id);
        ctx.toast("Proveedor eliminado");
        renderSuppliers();
      }
    });

    let lineCount = 1;

    const renderProducts = (): void => {
      const products = ctx.repos.products.list().filter((p) => p.active !== false);
      const options = products.map((p) => html`<option value="${p.id}">${p.name} (${p.um})</option>`);
      setHtml(
        purchaseLines,
        html`${Array.from({ length: lineCount }, (_, index) => html`
          <div class="row" data-purchase-line>
            <select class="input" data-purchase-product aria-label="Producto ${index + 1}">${options}</select>
            <input class="input" data-purchase-qty type="number" step="0.01" min="0.01" placeholder="Cantidad" required>
            <input class="input" data-purchase-total type="number" step="0.01" min="0.01" placeholder="Total pagado" required>
            ${lineCount > 1 ? html`<button class="ghost danger" data-remove-purchase-line type="button" aria-label="Quitar producto">Quitar</button>` : null}
          </div>
        `)}`
      );
    };

    addPurchaseLine.addEventListener("click", () => {
      lineCount += 1;
      renderProducts();
    });
    purchaseLines.addEventListener("click", (event) => {
      if ((event.target as HTMLElement).closest("[data-remove-purchase-line]")) {
        lineCount = Math.max(1, lineCount - 1);
        renderProducts();
      }
    });

    const render = (): void => {
      const branchId = ctx.branches.operationalId();
      renderSuppliers();
      renderProducts();
      const purchases = ctx.repos.purchases
        .list()
        .filter((purchase) => purchase.branch_id === branchId)
        .slice(0, 30);
      setHtml(
        list,
        purchases.length
          ? html`${purchases.map(
              (purchase) => html`
                <div class="list-item">
                  <div class="item-line">
                    <strong>${purchase.supplier}</strong>
                    <strong>${fmtMoneyPesos(purchase.total)}</strong>
                  </div>
                  <p class="muted">${purchase.product_name} | ${fmtQty(purchase.qty)} ${purchase.um ?? "Pza"} | ${fmtDateTime(purchase.created_at)}</p>
                </div>
              `
            )}`
          : html`<p class="muted">Sin compras registradas.</p>`
      );
    };

    purchaseForm.addEventListener("submit", (event) => {
      event.preventDefault();
      const supplier = ctx.repos.suppliers.byId(purchaseSupplier.value);
      const items = [...purchaseLines.querySelectorAll<HTMLElement>("[data-purchase-line]")].map((line) => ({
        productId: line.querySelector<HTMLSelectElement>("[data-purchase-product]")?.value ?? "",
        qty: Number(line.querySelector<HTMLInputElement>("[data-purchase-qty]")?.value || 0),
        totalPaid: Number(line.querySelector<HTMLInputElement>("[data-purchase-total]")?.value || 0)
      }));
      if (items.some((item) => !item.productId || !Number.isFinite(item.qty) || item.qty <= 0 || !Number.isFinite(item.totalPaid) || item.totalPaid <= 0)) {
        ctx.toast("Revisa producto, cantidad y total de todas las líneas");
        return;
      }
      const result = ctx.inventory.receiveStockMany(items, supplier?.name || "Entrada de inventario");
      if (!result.ok) {
        ctx.toast(result.error);
        return;
      }
      purchaseForm.reset();
      lineCount = 1;
      renderSuppliers();
      renderProducts();
      ctx.toast(`Compra registrada: ${result.count} productos, ${fmtQty(result.qty)} unidades`);
    });

    ctx.store.watch(
      (s) => [s.purchases, s.products, s.suppliers, s.branches, s.currentBranchId] as const,
      render
    );
    render();
  }
};
