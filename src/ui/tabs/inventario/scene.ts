import { html, setHtml, type SafeHtml } from "../../../core/html";
import type { AppContext } from "../../context";
import { iconFor } from "../../icons";
import { mountProductFilters, productFiltersMarkup, type ProductFilters } from "../../product-filters";
import { scanButtonMarkup, wireScanToSearch } from "../../scan-field";
import { mountSections, type Sections } from "../../sections";
import { renderList } from "./render";

/** Referencias del inventario (una por sección del markup). */
export interface InventarioRefs {
  summaryEl: HTMLElement;
  countSummaryEl: HTMLElement;
  listEl: HTMLElement;
  historyEl: HTMLElement;
  search: HTMLInputElement;
}

/** Base compartida del inventario: markup, referencias, filtros y estado de lista. */
export interface InventarioScene {
  ctx: AppContext;
  root: HTMLElement;
  ui: InventarioRefs;
  sections: Sections;
  filters: ProductFilters;
  state: { listPage: number; pendingListRender: boolean };
  /** Guarda (o limpia) el conteo en curso en el dispositivo: no se pierde al recargar. */
  saveCount(): void;
  /** ¿El foco está en una casilla de conteo? (mientras se escribe no se redibuja la lista). */
  isTypingCount(): boolean;
}

export function createInventarioScene(root: HTMLElement, ctx: AppContext): InventarioScene {
  setHtml(root, inventarioMarkup());

  // En celular: una sección a la vez (en computadora van lado a lado)
  const articles = [...root.querySelectorAll<HTMLElement>(":scope > .split > article")];
  const sections = mountSections(root, [
    { id: "existencias", label: "Existencias", el: articles[1] ?? null },
    { id: "resumen", label: "Resumen y conteo", el: articles[0] ?? null }
  ]);

  const ui: InventarioRefs = {
    summaryEl: root.querySelector<HTMLElement>("#inventorySummary")!,
    countSummaryEl: root.querySelector<HTMLElement>("#inventoryCountSummary")!,
    listEl: root.querySelector<HTMLElement>("#inventoryList")!,
    historyEl: root.querySelector<HTMLElement>("#inventoryCountsHistory")!,
    search: root.querySelector<HTMLInputElement>("#inventorySearch")!
  };
  wireScanToSearch(ctx, root.querySelector<HTMLElement>("#inventoryScan")!, ui.search);

  const state = { listPage: 0, pendingListRender: false };
  const isTypingCount = (): boolean => {
    const focused = document.activeElement;
    return Boolean(focused && ui.listEl.contains(focused) && (focused as HTMLElement).matches("[data-count-product]"));
  };

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

  const filters = mountProductFilters(root, "inventory", ctx, () => {
    state.listPage = 0;
    renderList(scene);
  });
  const scene: InventarioScene = { ctx, root, ui, sections, filters, state, saveCount, isTypingCount };
  return scene;
}

function inventarioMarkup(): SafeHtml {
  return html`
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
  `;
}
