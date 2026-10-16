import { nowISO } from "../../../core/dates";
import { fmtQty } from "../../../core/qty";
import { assignMissingSupplierNumbers } from "../../../domain/catalog";
import { confirmDialog } from "../../components/modal";
import { pagerClick } from "../../pager";
import { exportSuppliers, importSuppliers } from "../../product-transfer-ui";
import type { TabModule } from "../tab-module";
import { renderPurchases } from "./purchases";
import { CENTRAL_ID, CENTRAL_NAME, createProveedoresScene } from "./scene";
import { openSupplierForm, openSupplierProducts, renderSuppliers } from "./suppliers";

export const proveedoresTab: TabModule = {
  id: "proveedores",
  render(root, ctx) {
    const scene = createProveedoresScene(root, ctx);
    const { ui, state, lines, canManage, productCount } = scene;

    root.querySelector<HTMLButtonElement>("#downloadSuppliersXls")!.addEventListener("click", () => exportSuppliers(ctx, "xls"));
    root.querySelector<HTMLElement>("#importSuppliersLabel")!.hidden = !canManage();
    root.querySelector<HTMLInputElement>("#importSuppliers")!.addEventListener("change", async (event) => {
      const input = event.target as HTMLInputElement;
      const file = input.files?.[0];
      if (!file) return;
      await importSuppliers(ctx, file);
      input.value = "";
    });

    ui.addSupplierButton.addEventListener("click", () => openSupplierForm(scene));

    ui.suppliersList.addEventListener("click", async (event) => {
      const target = event.target as HTMLElement;
      const paging = pagerClick(event);
      if (paging) {
        state.supplierPage = paging.page;
        state.openSuppliers.clear();
        renderSuppliers(scene);
        return;
      }
      const productsButton = target.closest<HTMLElement>("[data-products-supplier]");
      if (productsButton) {
        const supplier = ctx.repos.suppliers.byId(productsButton.dataset.productsSupplier!);
        if (supplier) openSupplierProducts(scene, supplier);
        return;
      }
      const editButton = target.closest<HTMLElement>("[data-edit-supplier]");
      if (editButton) {
        const supplier = ctx.repos.suppliers.byId(editButton.dataset.editSupplier!);
        if (supplier) openSupplierForm(scene, supplier);
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

    ui.list.addEventListener("click", (event) => {
      const paging = pagerClick(event);
      if (!paging) return;
      state.purchasePage = paging.page;
      renderPurchases(scene);
    });
    ui.supplierSearch.addEventListener("input", () => {
      state.supplierPage = 0;
      renderSuppliers(scene);
    });
    // Recuerda qué proveedores están abiertos para no cerrarlos al sincronizar
    ui.suppliersList.addEventListener("toggle", (event) => {
      const row = event.target as HTMLDetailsElement;
      const id = row.dataset?.supplier;
      if (!id) return;
      if (row.open) state.openSuppliers.add(id);
      else state.openSuppliers.delete(id);
    }, true);

    root.querySelector<HTMLButtonElement>("#addPurchaseLine")!.addEventListener("click", () => lines.addLine());
    ui.purchaseSupplier.addEventListener("change", () => {
      // La Central de Abastos casi siempre se paga con dinero aparte.
      ui.purchasePaidFrom.value = ui.purchaseSupplier.value === CENTRAL_ID ? "aparte" : "caja";
      lines.render();
    });

    ui.purchaseForm.addEventListener("submit", (event) => {
      event.preventDefault();
      const central = ui.purchaseSupplier.value === CENTRAL_ID;
      const supplier = central ? undefined : ctx.repos.suppliers.byId(ui.purchaseSupplier.value);
      if (!central && (!supplier || supplier.deleted)) {
        ctx.toast("Elige el proveedor de la compra");
        return;
      }
      const read = lines.read();
      if (!read.ok) {
        ctx.toast(read.error);
        return;
      }
      const paidFrom = ui.purchasePaidFrom.value === "aparte" ? "aparte" : "caja";
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
      renderSuppliers(scene);
      lines.render();
    });
    ctx.store.watch((s) => s.products, () => {
      renderSuppliers(scene);
      lines.render();
    });
    ctx.store.watch((s) => [s.purchases, s.branches, s.currentBranchId] as const, () => renderPurchases(scene));
  }
};
