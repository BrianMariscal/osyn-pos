import { html, setHtml } from "../../core/html";
import { fmtDateTime, nowISO } from "../../core/dates";
import { uid } from "../../core/id";
import { fmtMoneyPesos, sumCents, toCents, toPesos } from "../../core/money";
import { fmtQty, normalizeQty } from "../../core/qty";
import { UNITS, type Product, type Unit } from "../../core/types";
import { isBulkUnit } from "../../core/units";
import { confirmDialog, openModal } from "../components/modal";
import { iconFor } from "../icons";
import { openCountPdf } from "../pdf";
import { scanBarcode } from "../scanner";
import { supplierLabel } from "../../domain/catalog";
import { categoryFieldMarkup, mountCategoryField, type CategoryField } from "../category-field";
import type { AppContext } from "../context";
import { mountProductFilters, productFiltersMarkup } from "../product-filters";
import { exportProducts, importProducts } from "../product-transfer-ui";
import { mountSections } from "../sections";
import { paginate, pagerClick, pagerMarkup } from "../pager";
import { scanButtonMarkup, wireScanToSearch } from "../scan-field";
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
              <button id="downloadInventoryXls" class="ghost" type="button">${iconFor("download")} Descargar Excel</button>
              <label class="import-label">${iconFor("upload")} Importar
                <input id="importInventory" type="file" accept=".csv,.xls,.xml,.txt,text/csv,application/vnd.ms-excel">
              </label>
              <button id="newProduct" class="primary" type="button">${iconFor("plus")} Nuevo producto</button>
            </div>

            <h2>Conteo físico</h2>
            <p class="hint">Captura lo que realmente hay en tienda (Enter pasa al siguiente). Lo capturado se guarda solo; el sistema compara contra la existencia de esta sucursal.</p>
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
              <input id="inventorySearch" class="input" type="search" placeholder="Buscar producto o código de barras" autocomplete="off">
              ${scanButtonMarkup("inventoryScan")}
            </div>
            ${productFiltersMarkup("inventory")}
            <div id="inventoryList" class="list"></div>
            <h2>Historial de conteos</h2>
            <div id="inventoryCountsHistory" class="list"></div>
          </article>
        </div>
      `
    );

    // En celular: una sección a la vez (en computadora van lado a lado)
    const articles = [...root.querySelectorAll<HTMLElement>(":scope > .split > article")];
    const sections = mountSections(root, [
      { id: "existencias", label: "Existencias", el: articles[1] ?? null },
      { id: "resumen", label: "Resumen y conteo", el: articles[0] ?? null }
    ]);

    const summaryEl = root.querySelector<HTMLElement>("#inventorySummary")!;
    const countSummaryEl = root.querySelector<HTMLElement>("#inventoryCountSummary")!;
    const listEl = root.querySelector<HTMLElement>("#inventoryList")!;
    const historyEl = root.querySelector<HTMLElement>("#inventoryCountsHistory")!;
    const search = root.querySelector<HTMLInputElement>("#inventorySearch")!;
    wireScanToSearch(ctx, root.querySelector<HTMLElement>("#inventoryScan")!, search);
    let searchTimer: ReturnType<typeof setTimeout> | undefined;
    const filters = mountProductFilters(root, "inventory", ctx, () => {
      listPage = 0;
      renderList();
    });
    let pendingListRender = false;
    const isTypingCount = (): boolean => {
      const focused = document.activeElement;
      return Boolean(focused && listEl.contains(focused) && (focused as HTMLElement).matches("[data-count-product]"));
    };

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
          <div><span>Estado</span><strong>Conteo en proceso · desde ${fmtDateTime(ctx.inventory.activeCount()?.started_at)}</strong></div>
          <div><span>Productos capturados</span><strong>${summary.captured}</strong></div>
          <div><span>Con faltante</span><strong>${summary.shortage}</strong></div>
          <div><span>Con sobrante</span><strong>${summary.surplus}</strong></div>
          <div><span>Ajustes a aplicar</span><strong>${summary.adjusted}</strong></div>
        `
      );
    };

    const renderList = (): void => {
      const branchId = ctx.branches.operationalId();
      const counting = Boolean(ctx.inventory.activeCount());
      // Todos los productos activos: los que aún no tienen existencia en esta
      // sucursal también se pueden contar (antes no aparecían).
      const stockByProduct = new Map(
        ctx.repos.stocks.list().filter((row) => row.branch_id === branchId).map((row) => [row.product_id, row])
      );
      filters.refresh();
      const rows = filters
        .apply(ctx.repos.products.list().filter((product) => product.active !== false), search.value)
        .map((product) => ({
          product,
          row: stockByProduct.get(product.id) ?? { stock: 0, min_stock: 0 }
        }));
      if (!rows.length) {
        setHtml(listEl, html`<p class="muted">${search.value.trim() || filters.active() ? "Ningún producto coincide." : "Sin productos en inventario."}</p>`);
        return;
      }
      // Sin conteo: de 15 en 15. Durante el conteo se ven todos (Enter pasa al siguiente).
      const page = paginate(rows, counting ? 0 : listPage, counting ? Math.max(rows.length, 1) : 15);
      setHtml(
        listEl,
        html`${page.items.map(({ row, product }) => {
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
                        <input class="input count-input" type="number" step="0.01" min="0" inputmode="decimal" enterkeyhint="next" value="${counted ?? ""}" data-count-product="${product!.id}" placeholder="—" aria-label="Cantidad física de ${product!.name}">
                      </label>
                      <p class="muted" data-diff-for="${product!.id}">${diffText(diff, product!.um)}</p>
                    </div>
                  `
                : html``}
            </div>
          `;
        })}${pagerMarkup("inventory", page)}`
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
          : html`<p class="muted">Aún no hay conteos aplicados.</p>`
      );
    };

    const renderAll = (): void => {
      renderSummary();
      renderCountSummary();
      if (isTypingCount()) pendingListRender = true;
      else renderList();
      renderHistory();
    };

    let listPage = 0;
    listEl.addEventListener("click", (event) => {
      const paging = pagerClick(event);
      if (!paging) return;
      listPage = paging.page;
      renderList();
      listEl.scrollIntoView({ behavior: "smooth", block: "start" });
    });
    search.addEventListener("input", () => {
      listPage = 0;
      if (searchTimer) clearTimeout(searchTimer);
      searchTimer = setTimeout(renderList, 180);
    });

    // Conteo en curso guardado en el dispositivo: no se pierde al recargar.
    const COUNT_KEY = "abarrotes-pos-active-count-v1";
    const saveCount = (): void => {
      try {
        const snapshot = ctx.inventory.snapshot();
        if (snapshot) localStorage.setItem(COUNT_KEY, JSON.stringify(snapshot));
        else localStorage.removeItem(COUNT_KEY);
      } catch {
        /* almacenamiento no disponible */
      }
    };
    try {
      const saved = localStorage.getItem(COUNT_KEY);
      if (saved) ctx.inventory.restore(JSON.parse(saved));
    } catch {
      /* respaldo dañado: se ignora */
    }

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

    // Cada tecla guarda la captura (antes no había listener: el valor se
    // perdía en cuanto la lista se volvía a dibujar por una venta o la sync).
    listEl.addEventListener("input", (event) => {
      const input = (event.target as HTMLElement).closest<HTMLInputElement>("[data-count-product]");
      if (!input) return;
      ctx.inventory.setCount(input.dataset.countProduct!, input.value);
      saveCount();
    });
    // Enter pasa al siguiente producto (captura rápida).
    listEl.addEventListener("keydown", (event) => {
      const input = (event.target as HTMLElement).closest<HTMLInputElement>("[data-count-product]");
      if (!input || event.key !== "Enter") return;
      event.preventDefault();
      const inputs = [...listEl.querySelectorAll<HTMLInputElement>("[data-count-product]")];
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
    listEl.addEventListener("focusout", (event) => {
      if (!pendingListRender) return;
      const next = (event as FocusEvent).relatedTarget as HTMLElement | null;
      if (next && listEl.contains(next) && next.matches("[data-count-product]")) return;
      pendingListRender = false;
      renderList();
    });

    // ---- Alta de producto (admin y vendedor) ----
    root.querySelector<HTMLButtonElement>("#newProduct")!.addEventListener("click", () => {
      openNewProductModal(ctx, () => renderAll());
    });

    root.querySelector<HTMLButtonElement>("#startInventoryCount")!.addEventListener("click", () => {
      if (ctx.inventory.activeCount()) {
        ctx.toast("Ya hay un conteo en proceso");
        return;
      }
      ctx.inventory.start();
      saveCount();
      renderCountSummary();
      renderList();
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
      renderAll();
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
      renderAll();
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
      renderAll
    );
    renderAll();
  }
};

export interface NewProductPreset {
  supplierId?: string;
  barcode?: string;
}

/** Modal de alta rápida de producto (Inventario, Proveedores y código no registrado en Venta). */
export function openNewProductModal(ctx: AppContext, onDone: (product: Product) => void, preset: NewProductPreset = {}): void {
  let category: CategoryField | null = null;
  const suppliers = ctx.repos.suppliers.list().sort((a, b) => (a.number ?? 0) - (b.number ?? 0) || a.name.localeCompare(b.name));
  openModal({
    title: "Nuevo producto",
    content: html`
      ${preset.barcode ? html`<p class="muted">El código ${preset.barcode} no está registrado. Captura el producto para agregarlo.</p>` : html``}
      <label class="form-field">Nombre
        <input id="pName" class="input" required>
      </label>
      <div class="row">
        ${categoryFieldMarkup("pCategory")}
        <label class="form-field">Unidad
          <select id="pUnit" class="input">
            ${UNITS.map((unit) => html`<option value="${unit}">${unit}</option>`)}
          </select>
        </label>
      </div>
      <div class="row">
        <label class="form-field">Costo <span id="pCostUnit" class="muted"></span>
          <input id="pCost" class="input" type="number" step="0.01" min="0" inputmode="decimal">
        </label>
        <label class="form-field">Precio de venta <span id="pPriceUnit" class="muted"></span>
          <input id="pPrice" class="input" type="number" step="0.01" min="0" inputmode="decimal" required>
        </label>
      </div>
      <p id="pPriceHint" class="hint hidden">Con la unidad Gr el precio se cobra POR GRAMO. Si cobras por kilo, usa la unidad Kg.</p>
      <div class="row">
        <label class="form-field">Proveedor
          <select id="pSupplier" class="input">
            <option value="">Sin proveedor</option>
            ${suppliers.map((s) => html`<option value="${s.id}" ${s.id === preset.supplierId ? "selected" : null}>${supplierLabel(s)}</option>`)}
          </select>
        </label>
        <label class="form-field">Piezas por caja
          <input id="pPack" class="input" type="number" step="1" min="0" inputmode="numeric" placeholder="Opcional">
        </label>
      </div>
      <div class="search-row">
        <label class="form-field">Código de barras / QR (opcional)
          <input id="pBarcode" class="input" inputmode="numeric" value="${preset.barcode ?? ""}">
        </label>
        <button id="pScan" class="ghost align-end" type="button">${iconFor("barcode")} Escanear</button>
      </div>
      <div class="row">
        <label class="form-field">Existencia inicial (esta sucursal)
          <input id="pStock" class="input" type="number" step="0.01" min="0" value="0" inputmode="decimal">
        </label>
        <label class="form-field">Mínimo
          <input id="pMin" class="input" type="number" step="0.01" min="0" value="2" inputmode="decimal">
        </label>
      </div>
    `,
    actions: [
      { label: "Cancelar", kind: "ghost", onClick: (close) => close() },
      {
        label: "Crear producto",
        kind: "primary",
        onClick: (close) => {
          const value = (id: string): string => (document.getElementById(id) as HTMLInputElement).value.trim();
          const name = value("pName");
          const price = Number(value("pPrice") || 0);
          if (!name || !(price > 0)) {
            ctx.toast("Nombre y precio son obligatorios");
            return;
          }
          const barcode = value("pBarcode");
          if (barcode && ctx.repos.products.list().some((p) => p.barcode?.trim() === barcode)) {
            ctx.toast("Ese código ya pertenece a otro producto");
            return;
          }
          const ts = nowISO();
          const packSize = Math.round(normalizeQty(value("pPack")));
          const product: Product = {
            id: uid(),
            name,
            category: category?.get() ?? "",
            um: (document.getElementById("pUnit") as HTMLSelectElement).value as Unit,
            cost: Math.max(0, Number(value("pCost") || 0)),
            price,
            barcode: barcode || undefined,
            supplier_id: value("pSupplier") || undefined,
            pack_size: packSize > 1 ? packSize : undefined,
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
            stock: normalizeQty(value("pStock")),
            min_stock: normalizeQty(value("pMin")),
            updated_at: ts
          });
          close();
          ctx.toast(`${name} creado`);
          onDone(product);
        }
      }
    ],
    onOpen: (modalRoot) => {
      const presetSupplier = preset.supplierId ? ctx.repos.suppliers.byId(preset.supplierId) : undefined;
      category = mountCategoryField(modalRoot, "pCategory", ctx);
      if (presetSupplier?.type) category.set(presetSupplier.type);
      // A granel el precio es por unidad base (Kg, Gr, Lts): se avisa en la etiqueta
      const unitSelect = modalRoot.querySelector<HTMLSelectElement>("#pUnit");
      const priceField = modalRoot.querySelector<HTMLInputElement>("#pPrice");
      const syncLabels = (): void => {
        const unit = (unitSelect?.value ?? "Pza") as Unit;
        const bulk = isBulkUnit(unit);
        const costLabel = modalRoot.querySelector<HTMLElement>("#pCostUnit");
        const priceLabel = modalRoot.querySelector<HTMLElement>("#pPriceUnit");
        const hint = modalRoot.querySelector<HTMLElement>("#pPriceHint");
        if (costLabel) costLabel.textContent = bulk ? `(por ${unit})` : "";
        if (priceLabel) priceLabel.textContent = bulk ? `(por ${unit})` : "";
        hint?.classList.toggle("hidden", !(unit === "Gr" && Number(priceField?.value || 0) >= 1));
      };
      unitSelect?.addEventListener("change", syncLabels);
      priceField?.addEventListener("input", syncLabels);
      syncLabels();
      modalRoot.querySelector<HTMLSelectElement>("#pSupplier")?.addEventListener("change", (event) => {
        const supplier = ctx.repos.suppliers.byId((event.target as HTMLSelectElement).value);
        if (supplier?.type && category?.isDefault()) category.set(supplier.type);
      });
      modalRoot.querySelector<HTMLButtonElement>("#pScan")?.addEventListener("click", async () => {
        try {
          const code = await scanBarcode();
          if (code) (document.getElementById("pBarcode") as HTMLInputElement).value = code;
        } catch (error) {
          ctx.toast(error instanceof Error ? error.message : "No se pudo escanear");
        }
      });
      if (preset.barcode) modalRoot.querySelector<HTMLInputElement>("#pName")?.focus();
    }
  });
}

function diffText(diff: number | null, um: string): ReturnType<typeof html> {
  if (diff === null) return html`Diferencia: sin capturar`;
  const sign = diff > 0 ? "+" : "";
  const cls = diff < 0 ? "diff-negative" : diff > 0 ? "diff-positive" : "muted";
  return html`Diferencia: <span class="${cls}">${sign}${fmtQty(diff)} ${um}</span>`;
}
