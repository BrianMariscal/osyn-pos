import { setHtml } from "../../../core/html";
import { normalizeQty } from "../../../core/qty";
import { confirmDialog } from "../../components/modal";
import { pagerClick } from "../../pager";
import { openCountPdf } from "../../pdf";
import { exportProducts, importProducts } from "../../product-transfer-ui";
import type { TabModule } from "../tab-module";
import { openNewProductModal } from "./new-product";
import { diffText, renderAll, renderCountSummary, renderList } from "./render";
import { createInventarioScene } from "./scene";

export { openNewProductModal } from "./new-product";
export type { NewProductPreset } from "./new-product";

export const inventarioTab: TabModule = {
  id: "inventario",
  render(root, ctx) {
    const scene = createInventarioScene(root, ctx);
    const { ui, state, sections, saveCount } = scene;
    let searchTimer: ReturnType<typeof setTimeout> | undefined;

    ui.listEl.addEventListener("click", (event) => {
      const paging = pagerClick(event);
      if (!paging) return;
      state.listPage = paging.page;
      renderList(scene);
      ui.listEl.scrollIntoView({ behavior: "smooth", block: "start" });
    });
    ui.onlyDiff.addEventListener("change", () => renderList(scene));
    ui.search.addEventListener("input", () => {
      state.listPage = 0;
      if (searchTimer) clearTimeout(searchTimer);
      searchTimer = setTimeout(() => renderList(scene), 180);
    });

    ctx.inventory.onCountChange = (productId) => {
      const branchId = ctx.branches.operationalId();
      const row = ctx.repos.stocks.list().find((stock) => stock.product_id === productId && stock.branch_id === branchId);
      const product = ctx.repos.products.byId(productId);
      const counted = ctx.inventory.countedValue(productId);
      const systemStock = ctx.inventory.baselineFor(productId) ?? row?.stock ?? 0;
      const diff =
        counted === undefined || counted === "" || !product
          ? null
          : Math.round((normalizeQty(counted) - normalizeQty(systemStock)) * 100) / 100;
      const label = ui.listEl.querySelector<HTMLElement>(`[data-diff-for="${CSS.escape(productId)}"]`);
      if (label) setHtml(label, diffText(diff, product?.um ?? "Pza"));
      renderCountSummary(scene);
    };

    // Cada tecla guarda la captura (antes no había listener: el valor se
    // perdía en cuanto la lista se volvía a dibujar por una venta o la sync).
    ui.listEl.addEventListener("input", (event) => {
      const input = (event.target as HTMLElement).closest<HTMLInputElement>("[data-count-product]");
      if (!input) return;
      ctx.inventory.setCount(input.dataset.countProduct!, input.value);
      saveCount();
    });
    // Enter pasa al siguiente producto (captura rápida).
    ui.listEl.addEventListener("keydown", (event) => {
      const input = (event.target as HTMLElement).closest<HTMLInputElement>("[data-count-product]");
      if (!input || event.key !== "Enter") return;
      event.preventDefault();
      const inputs = [...ui.listEl.querySelectorAll<HTMLInputElement>("[data-count-product]")];
      const next = inputs[inputs.indexOf(input) + 1];
      if (next) {
        next.focus();
        next.select();
      } else {
        input.blur();
      }
    });
    // Mientras se escribe NO se redibuja la lista (perdía foco y captura);
    // el redibujo pendiente se hace al salir del campo.
    ui.listEl.addEventListener("focusout", (event) => {
      if (!state.pendingListRender) return;
      const next = (event as FocusEvent).relatedTarget as HTMLElement | null;
      if (next && ui.listEl.contains(next) && next.matches("[data-count-product]")) return;
      state.pendingListRender = false;
      renderList(scene);
    });

    // ---- Alta de producto (admin y vendedor) ----
    root.querySelector<HTMLButtonElement>("#newProduct")!.addEventListener("click", () => {
      openNewProductModal(ctx, () => renderAll(scene));
    });

    root.querySelector<HTMLButtonElement>("#startInventoryCount")!.addEventListener("click", () => {
      if (ctx.inventory.activeCount()) {
        ctx.toast("Ya hay un conteo en proceso");
        return;
      }
      ctx.inventory.start();
      ui.onlyDiff.checked = false;
      saveCount();
      renderAll(scene);
      // En celular las casillas de conteo están en Existencias
      sections.show("existencias");
      ctx.toast("Conteo físico iniciado: captura en Existencias");
    });

    root.querySelector<HTMLButtonElement>("#applyInventoryCount")!.addEventListener("click", async () => {
      const summary = ctx.inventory.summary();
      if (!summary || !summary.captured) {
        ctx.toast("Captura cantidades físicas primero");
        return;
      }
      const confirmed = await confirmDialog({
        title: "Aplicar ajustes de inventario",
        message: `Se aplicarán ${summary.adjusted} ajustes y se generará el reporte PDF.`,
        confirmLabel: "Aplicar",
        danger: true
      });
      if (!confirmed) return;
      const result = ctx.inventory.apply();
      if (!result.ok) {
        ctx.toast(result.error);
        return;
      }
      saveCount();
      openCountPdf(ctx.store.getState().settings.storeName || "Mi tienda", result.count);
      ctx.toast("Inventario ajustado");
      renderAll(scene);
    });

    root.querySelector<HTMLButtonElement>("#cancelInventoryCount")!.addEventListener("click", async () => {
      if (!ctx.inventory.activeCount()) {
        ctx.toast("No hay conteo activo");
        return;
      }
      const confirmed = await confirmDialog({
        title: "Cancelar conteo",
        message: "Se descartarán las cantidades capturadas.",
        confirmLabel: "Cancelar conteo",
        danger: true
      });
      if (!confirmed) return;
      ctx.inventory.cancel();
      saveCount();
      renderAll(scene);
    });

    root.querySelector<HTMLButtonElement>("#downloadInventoryXls")!.addEventListener("click", () => exportProducts(ctx, "xls", "inventario"));
    // Importar modifica el catálogo: solo dueño/administrador (así lo exige la base de datos).
    root.querySelector<HTMLInputElement>("#importInventory")!.closest("label")!.hidden = !ctx.auth.isAdmin();
    root.querySelector<HTMLInputElement>("#importInventory")!.addEventListener("change", async (event) => {
      const input = event.target as HTMLInputElement;
      const file = input.files?.[0];
      if (!file) return;
      await importProducts(ctx, file);
      input.value = "";
    });

    ctx.store.watch(
      (s) => [s.products, s.product_stocks, s.inventory_counts, s.branches, s.currentBranchId] as const,
      () => renderAll(scene)
    );
    renderAll(scene);
  }
};
