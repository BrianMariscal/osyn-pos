import { html, setHtml } from "../../core/html";
import { fmtDateTime } from "../../core/dates";
import { uid } from "../../core/id";
import { fmtMoneyPesos, sumCents, toCents, toPesos } from "../../core/money";
import { fmtQty, normalizeQty } from "../../core/qty";
import { UNITS, type Product, type Unit } from "../../core/types";
import { confirmDialog, openModal } from "../components/modal";
import { iconFor } from "../icons";
import { openCountPdf } from "../pdf";
import { scanBarcode } from "../scanner";
import { downloadCsv } from "./download";
import type { AppContext } from "../context";
import type { TabModule } from "./tab-module";

export const inventarioTab: TabModule = {
  id: "inventario",
  render(root, ctx) {
    setHtml(
      root,
      html`
        <div class="split">
          <article class="card">
            <h2>Resumen de inventario</h2>
            <div id="inventorySummary" class="summary"></div>
            <div class="actions">
              <button id="downloadInventoryCsv" class="ghost" type="button">${iconFor("download")} Descargar CSV</button>
              <button id="newProduct" class="primary" type="button">${iconFor("plus")} Nuevo producto</button>
            </div>

            <h2>Conteo físico</h2>
            <p class="hint">Captura lo que realmente hay en tienda. El sistema compara contra la existencia de esta sucursal.</p>
            <div class="actions wrap-actions">
              <button id="startInventoryCount" class="primary" type="button">${iconFor("layers")} Iniciar conteo</button>
              <button id="applyInventoryCount" class="danger ghost" type="button">${iconFor("edit")} Aplicar ajustes</button>
              <button id="cancelInventoryCount" class="ghost" type="button">Cancelar conteo</button>
            </div>
            <div id="inventoryCountSummary" class="summary"></div>
          </article>

          <article class="card">
            <h2>Existencias y alertas</h2>
            <div class="search-row">
              <input id="inventorySearch" class="input" placeholder="Buscar producto" autocomplete="off">
            </div>
            <div id="inventoryList" class="list"></div>
            <h2>Historial de conteos</h2>
            <div id="inventoryCountsHistory" class="list"></div>
          </article>
        </div>
      `
    );

    const summaryEl = root.querySelector<HTMLElement>("#inventorySummary")!;
    const countSummaryEl = root.querySelector<HTMLElement>("#inventoryCountSummary")!;
    const listEl = root.querySelector<HTMLElement>("#inventoryList")!;
    const historyEl = root.querySelector<HTMLElement>("#inventoryCountsHistory")!;
    const search = root.querySelector<HTMLInputElement>("#inventorySearch")!;
    let searchTimer: ReturnType<typeof setTimeout> | undefined;

    const renderSummary = (): void => {
      const branchId = ctx.branches.operationalId();
      const rows = ctx.repos.stocks.list().filter((row) => row.branch_id === branchId);
      const withProduct = rows
        .map((row) => ({ row, product: ctx.repos.products.byId(row.product_id) }))
        .filter((entry): entry is { row: typeof rows[number]; product: NonNullable<typeof entry.product> } =>
          Boolean(entry.product && entry.product.active !== false)
        );
      const costCents = sumCents(withProduct.map(({ row, product }) => Math.round(row.stock * toCents(product.cost))));
      const saleCents = sumCents(withProduct.map(({ row, product }) => Math.round(row.stock * toCents(product.price))));
      const low = withProduct.filter(({ row }) => row.stock <= row.min_stock);
      setHtml(
        summaryEl,
        html`
          <div><span>Productos activos</span><strong>${withProduct.length}</strong></div>
          <div><span>Productos bajos</span><strong>${low.length}</strong></div>
          <div><span>Valor a costo</span><strong>${fmtMoneyPesos(toPesos(costCents))}</strong></div>
          <div><span>Valor a venta</span><strong>${fmtMoneyPesos(toPesos(saleCents))}</strong></div>
          <div><span>Ganancia potencial</span><strong>${fmtMoneyPesos(toPesos(saleCents - costCents))}</strong></div>
        `
      );
    };

    const renderCountSummary = (): void => {
      const summary = ctx.inventory.summary();
      if (!summary) {
        setHtml(countSummaryEl, html`<p class="muted">No hay conteo activo.</p>`);
        return;
      }
      setHtml(
        countSummaryEl,
        html`
          <div><span>Estado</span><strong>Conteo en proceso</strong></div>
          <div><span>Productos capturados</span><strong>${summary.captured}</strong></div>
          <div><span>Con faltante</span><strong>${summary.shortage}</strong></div>
          <div><span>Con sobrante</span><strong>${summary.surplus}</strong></div>
          <div><span>Ajustes a aplicar</span><strong>${summary.adjusted}</strong></div>
        `
      );
    };

    const renderList = (): void => {
      const branchId = ctx.branches.operationalId();
      const counting = ctx.inventory.isActive();
      const q = search.value.toLowerCase().trim();
      const rows = ctx.repos.stocks
        .list()
        .filter((row) => row.branch_id === branchId)
        .map((row) => ({ row, product: ctx.repos.products.byId(row.product_id) }))
        .filter((entry) => entry.product && entry.product.active !== false)
        .filter(({ product }) => !q || product!.name.toLowerCase().includes(q) || (product!.category || "").toLowerCase().includes(q))
        .sort((a, b) => a.product!.name.localeCompare(b.product!.name));
      if (!rows.length) {
        setHtml(listEl, html`<p class="muted">Sin productos en inventario.</p>`);
        return;
      }
      setHtml(
        listEl,
        html`${rows.map(({ row, product }) => {
          const counted = counting ? ctx.inventory.countedValue(product!.id) : undefined;
          const diff =
            counted === undefined || counted === ""
              ? null
              : Math.round((normalizeQty(counted) - normalizeQty(row.stock)) * 100) / 100;
          return html`
            <div class="list-item ${row.stock <= row.min_stock ? "low" : ""}">
              <div class="item-line">
                <strong>${product!.name}</strong>
                <strong>${fmtQty(row.stock)} ${product!.um}</strong>
              </div>
              <p class="muted">${product!.category || "Sin categoría"} | Mín ${fmtQty(row.min_stock)} | Costo ${fmtMoneyPesos(product!.cost)} | Venta ${fmtMoneyPesos(product!.price)}</p>
              ${counting
                ? html`
                    <div class="item-line">
                      <label class="count-label">Físico
                        <input class="input count-input" type="number" step="0.01" value="${counted ?? ""}" data-count-product="${product!.id}" placeholder="0">
                      </label>
                      <p class="muted" data-diff-for="${product!.id}">${diffText(diff, product!.um)}</p>
                    </div>
                  `
                : html``}
            </div>
          `;
        })}`
      );
    };

    const renderHistory = (): void => {
      const history = ctx.inventory.history();
      setHtml(
        historyEl,
        history.length
          ? html`${history.slice(0, 12).map(
              (count) => html`
                <div class="list-item">
                  <div class="item-line"><strong>${fmtDateTime(count.applied_at)}</strong><strong>${count.summary.adjusted ?? 0} ajustes</strong></div>
                  <p class="muted">Faltantes ${count.summary.shortage ?? 0} | Sobrantes ${count.summary.surplus ?? 0} | Impacto costo ${fmtMoneyPesos(count.summary.costImpact ?? 0)}</p>
                </div>
              `
            )}`
          : html``
      );
    };

    const renderAll = (): void => {
      renderSummary();
      renderCountSummary();
      renderList();
      renderHistory();
    };

    search.addEventListener("input", () => {
      if (searchTimer) clearTimeout(searchTimer);
      searchTimer = setTimeout(renderList, 180);
    });

    ctx.inventory.onCountChange = (productId) => {
      const branchId = ctx.branches.operationalId();
      const row = ctx.repos.stocks.list().find((stock) => stock.product_id === productId && stock.branch_id === branchId);
      const product = ctx.repos.products.byId(productId);
      const counted = ctx.inventory.countedValue(productId);
      const diff =
        counted === undefined || counted === "" || !product
          ? null
          : Math.round((normalizeQty(counted) - normalizeQty(row?.stock ?? 0)) * 100) / 100;
      const label = listEl.querySelector<HTMLElement>(`[data-diff-for="${CSS.escape(productId)}"]`);
      if (label) setHtml(label, diffText(diff, product?.um ?? "Pza"));
      renderCountSummary();
    };

    // ---- Alta de producto (admin y vendedor) ----
    root.querySelector<HTMLButtonElement>("#newProduct")!.addEventListener("click", () => {
      openNewProductModal(ctx, () => renderAll());
    });

    root.querySelector<HTMLButtonElement>("#startInventoryCount")!.addEventListener("click", () => {
      ctx.inventory.start();
      renderCountSummary();
      renderList();
      ctx.toast("Conteo físico iniciado");
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
      openCountPdf(ctx.store.getState().settings.storeName || "Mi tienda", result.count);
      ctx.toast("Inventario ajustado");
      renderAll();
    });

    root.querySelector<HTMLButtonElement>("#cancelInventoryCount")!.addEventListener("click", async () => {
      if (!ctx.inventory.isActive()) {
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
      renderAll();
    });

    root.querySelector<HTMLButtonElement>("#downloadInventoryCsv")!.addEventListener("click", () => {
      const branchId = ctx.branches.operationalId();
      const rows = ctx.repos.stocks
        .list()
        .filter((row) => row.branch_id === branchId)
        .map((row) => ({ row, product: ctx.repos.products.byId(row.product_id) }))
        .filter((entry) => entry.product && entry.product.active !== false);
      downloadCsv("inventario.csv", [
        ["nombre", "categoria", "um", "costo", "precio", "existencia", "minimo", "valor_costo", "valor_venta"],
        ...rows.map(({ row, product }) => [
          product!.name,
          product!.category ?? "",
          product!.um,
          String(product!.cost ?? 0),
          String(product!.price ?? 0),
          String(row.stock),
          String(row.min_stock),
          String(row.stock * (product!.cost ?? 0)),
          String(row.stock * (product!.price ?? 0))
        ])
      ]);
    });

    ctx.store.watch(
      (s) => [s.products, s.product_stocks, s.inventory_counts, s.branches, s.currentBranchId] as const,
      renderAll
    );
    renderAll();
  }
};

/** Modal de alta rápida de producto; se usa desde Inventario (admin y vendedor). */
export function openNewProductModal(ctx: AppContext, onDone: () => void): void {
  openModal({
    title: "Nuevo producto",
    content: html`
      <label class="form-field">Nombre
        <input id="pName" class="input" required>
      </label>
      <div class="row">
        <label class="form-field">Categoría
          <input id="pCategory" class="input" value="Abarrotes">
        </label>
        <label class="form-field">Unidad
          <select id="pUnit" class="input">
            ${UNITS.map((unit) => html`<option value="${unit}">${unit}</option>`)}
          </select>
        </label>
      </div>
      <div class="row">
        <label class="form-field">Costo
          <input id="pCost" class="input" type="number" step="0.01" min="0">
        </label>
        <label class="form-field">Precio de venta
          <input id="pPrice" class="input" type="number" step="0.01" min="0" required>
        </label>
      </div>
      <div class="search-row">
        <label class="form-field">Código de barras (opcional)
          <input id="pBarcode" class="input" inputmode="numeric">
        </label>
        <button id="pScan" class="ghost" type="button" style="align-self: end;">Escanear</button>
      </div>
      <div class="row">
        <label class="form-field">Existencia inicial (esta sucursal)
          <input id="pStock" class="input" type="number" step="0.01" value="0">
        </label>
        <label class="form-field">Mínimo
          <input id="pMin" class="input" type="number" step="0.01" value="2">
        </label>
      </div>
    `,
    actions: [
      { label: "Cancelar", kind: "ghost", onClick: (close) => close() },
      {
        label: "Crear producto",
        kind: "primary",
        onClick: (close) => {
          const name = (document.getElementById("pName") as HTMLInputElement).value.trim();
          const price = Number((document.getElementById("pPrice") as HTMLInputElement).value || 0);
          if (!name || price <= 0) {
            ctx.toast("Nombre y precio son obligatorios");
            return;
          }
          const ts = new Date().toISOString();
          const barcode = (document.getElementById("pBarcode") as HTMLInputElement).value.trim();
          const product: Product = {
            id: uid(),
            name,
            category: (document.getElementById("pCategory") as HTMLInputElement).value.trim(),
            um: (document.getElementById("pUnit") as HTMLSelectElement).value as Unit,
            cost: Number((document.getElementById("pCost") as HTMLInputElement).value || 0),
            price,
            barcode: barcode || undefined,
            active: true,
            created_at: ts,
            updated_at: ts
          };
          ctx.repos.products.upsert(product);
          const branchId = ctx.branches.operationalId();
          ctx.repos.stocks.upsert({
            id: `${product.id}:${branchId}`,
            product_id: product.id,
            branch_id: branchId,
            stock: normalizeQty((document.getElementById("pStock") as HTMLInputElement).value),
            min_stock: normalizeQty((document.getElementById("pMin") as HTMLInputElement).value),
            updated_at: ts
          });
          close();
          ctx.toast(`${name} creado`);
          onDone();
        }
      }
    ],
    onOpen: (modalRoot) => {
      modalRoot.querySelector<HTMLButtonElement>("#pScan")?.addEventListener("click", async () => {
        try {
          const code = await scanBarcode();
          if (code) (document.getElementById("pBarcode") as HTMLInputElement).value = code;
        } catch (error) {
          ctx.toast(error instanceof Error ? error.message : "No se pudo escanear");
        }
      });
    }
  });
}

function diffText(diff: number | null, um: string): ReturnType<typeof html> {
  if (diff === null) return html`Diferencia: sin capturar`;
  const sign = diff > 0 ? "+" : "";
  const cls = diff < 0 ? "diff-negative" : diff > 0 ? "diff-positive" : "muted";
  return html`Diferencia: <span class="${cls}">${sign}${fmtQty(diff)} ${um}</span>`;
}
