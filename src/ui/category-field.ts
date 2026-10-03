/**
 * Campo de categoría: lista desplegable (categorías base + las ya usadas + el
 * giro de cada proveedor) con opción "+ Nueva categoría…". Antes era un input
 * con datalist precargado en "Abarrotes", que filtraba la lista y no dejaba
 * elegir otra categoría (sobre todo en Android).
 */
import { html, setHtml } from "../core/html";
import { categoryOptions } from "../domain/catalog";
import type { AppContext } from "./context";

const NEW_CATEGORY = "__nueva__";

export function categoryFieldMarkup(id: string, label = "Categoría") {
  return html`
    <div class="form-field category-field">
      <label for="${id}">${label}</label>
      <select id="${id}" class="input"></select>
      <input id="${id}New" class="input hidden" placeholder="Nombre de la nueva categoría" aria-label="Nueva categoría" autocomplete="off">
    </div>
  `;
}

export interface CategoryField {
  /** Valor elegido (o escrito si es nueva). */
  get(): string;
  set(value: string): void;
  /** Vuelve a leer categorías (productos o proveedores cambiaron). */
  refresh(): void;
  /** True si el usuario no ha tocado el campo (sigue en el valor por defecto). */
  isDefault(): boolean;
}

export function mountCategoryField(root: ParentNode, id: string, ctx: AppContext, initial = "Abarrotes"): CategoryField {
  const select = root.querySelector<HTMLSelectElement>(`#${id}`)!;
  const custom = root.querySelector<HTMLInputElement>(`#${id}New`)!;
  let current = initial;
  let touched = false;

  const render = (): void => {
    const options = categoryOptions(ctx.repos.products.list(), ctx.repos.suppliers.list());
    if (current && !options.some((option) => option.toLowerCase() === current.toLowerCase())) options.push(current);
    const selected = options.find((option) => option.toLowerCase() === current.toLowerCase()) ?? "";
    setHtml(
      select,
      html`<option value="" ${selected ? null : "selected"}>Sin categoría</option>
        ${options.map((option) => html`<option value="${option}" ${option === selected ? "selected" : null}>${option}</option>`)}
        <option value="${NEW_CATEGORY}">+ Nueva categoría…</option>`
    );
    custom.classList.add("hidden");
  };

  select.addEventListener("change", () => {
    touched = true;
    if (select.value === NEW_CATEGORY) {
      custom.classList.remove("hidden");
      custom.value = "";
      custom.focus();
      return;
    }
    custom.classList.add("hidden");
    current = select.value;
  });
  custom.addEventListener("input", () => {
    current = custom.value.trim();
  });

  render();
  return {
    get: () => (select.value === NEW_CATEGORY ? custom.value.trim() : select.value),
    set(value: string) {
      current = value.trim();
      touched = false;
      render();
    },
    refresh() {
      // Si está escribiendo una categoría nueva no se interrumpe.
      if (select.value === NEW_CATEGORY) return;
      render();
    },
    isDefault: () => !touched && (current === "" || current === initial)
  };
}
