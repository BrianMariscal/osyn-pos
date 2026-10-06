/**
 * Búsqueda + filtros de proveedor y categoría para listas de productos
 * (Venta, Productos, Inventario). La búsqueda prioriza el nombre del producto;
 * el proveedor se elige con su filtro, no se mezcla con lo buscado.
 */
import { html, setHtml } from "../core/html";
import type { Product, Supplier } from "../core/types";
import { matchesCategoryFilter, matchesSupplierFilter, plainText, searchProducts, supplierLabel } from "../domain/catalog";
import type { AppContext } from "./context";

export function productFiltersMarkup(prefix: string) {
  return html`
    <div class="filter-grid">
      <select id="${prefix}SupplierFilter" class="input" aria-label="Filtrar por proveedor"></select>
      <select id="${prefix}CategoryFilter" class="input" aria-label="Filtrar por categoría"></select>
    </div>
  `;
}

export interface ProductFilters {
  /** Vuelve a llenar los selectores (cambiaron proveedores o productos). */
  refresh(): void;
  /** Aplica búsqueda + filtros a la lista. */
  apply<T extends Product>(products: readonly T[], query: string): T[];
  /** True si hay algún filtro elegido. */
  active(): boolean;
  clear(): void;
}

export function mountProductFilters(root: ParentNode, prefix: string, ctx: AppContext, onChange: () => void): ProductFilters {
  const supplierSelect = root.querySelector<HTMLSelectElement>(`#${prefix}SupplierFilter`)!;
  const categorySelect = root.querySelector<HTMLSelectElement>(`#${prefix}CategoryFilter`)!;

  const refresh = (): void => {
    const suppliers = ctx.repos.suppliers.list().sort((a, b) => (a.number ?? 0) - (b.number ?? 0) || a.name.localeCompare(b.name));
    const supplierValue = supplierSelect.value;
    setHtml(
      supplierSelect,
      html`<option value="">Todos los proveedores</option>
        ${suppliers.map((s) => html`<option value="${s.id}" ${s.id === supplierValue ? "selected" : null}>${supplierLabel(s)}</option>`)}
        <option value="none" ${supplierValue === "none" ? "selected" : null}>Sin proveedor</option>`
    );
    if (supplierValue && supplierSelect.value !== supplierValue) supplierSelect.value = "";
    supplierSelect.classList.toggle("hidden", !suppliers.length);

    const byKey = new Map<string, string>();
    let uncategorized = false;
    for (const product of ctx.repos.products.list()) {
      const clean = (product.category ?? "").trim();
      if (!clean) uncategorized = true;
      else if (!byKey.has(plainText(clean))) byKey.set(plainText(clean), clean);
    }
    const categories = [...byKey.values()].sort((a, b) => a.localeCompare(b, "es"));
    const categoryValue = categorySelect.value;
    setHtml(
      categorySelect,
      html`<option value="">Todas las categorías</option>
        ${categories.map((c) => html`<option value="${c}" ${c === categoryValue ? "selected" : null}>${c}</option>`)}
        ${uncategorized ? html`<option value="none" ${categoryValue === "none" ? "selected" : null}>Sin categoría</option>` : html``}`
    );
    if (categoryValue && categorySelect.value !== categoryValue) categorySelect.value = "";
  };

  supplierSelect.addEventListener("change", onChange);
  categorySelect.addEventListener("change", onChange);
  refresh();

  return {
    refresh,
    apply(products, query) {
      const suppliers = new Map<string, Supplier>(ctx.repos.suppliers.list().map((s) => [s.id, s]));
      const ids = new Set(suppliers.keys());
      const filtered = products.filter(
        (p) => matchesSupplierFilter(p, supplierSelect.value, ids) && matchesCategoryFilter(p, categorySelect.value)
      );
      return searchProducts(filtered, query, (p) => (p.supplier_id ? suppliers.get(p.supplier_id) : undefined));
    },
    active: () => Boolean(supplierSelect.value || categorySelect.value),
    clear() {
      supplierSelect.value = "";
      categorySelect.value = "";
    }
  };
}
