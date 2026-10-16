import { mountProductFilters } from "../../product-filters";
import { exportProducts, importProducts } from "../../product-transfer-ui";
import type { TabModule } from "../tab-module";
import { createProductForm } from "./form";
import { createProductList } from "./list";
import { createProductosScene } from "./scene";

export const productosTab: TabModule = {
  id: "productos",
  render(root, ctx) {
    const scene = createProductosScene(root, ctx);
    // El filtro de categoría avisa a la lista (que se crea después).
    let onFiltersChange: () => void = () => undefined;
    const filters = mountProductFilters(root, "products", ctx, () => onFiltersChange());
    const form = createProductForm(scene, filters);
    const list = createProductList(scene, filters, form);
    onFiltersChange = list.onFiltersChanged;

    root.querySelector<HTMLButtonElement>("#downloadTemplate")!.addEventListener("click", () => exportProducts(ctx, "xls"));

    root.querySelector<HTMLInputElement>("#importProducts")!.addEventListener("change", async (event) => {
      const input = event.target as HTMLInputElement;
      const file = input.files?.[0];
      if (!file) return;
      await importProducts(ctx, file);
      input.value = "";
    });

    ctx.store.watch((s) => s.suppliers, () => {
      form.renderSupplierOptions();
      list.render();
    });
    ctx.store.watch((s) => [s.products, s.product_stocks, s.branches, s.currentBranchId] as const, () => list.render());
  }
};
