/**
 * Paginación para listas largas: en lugar de una lista infinita que obliga a
 * desplazarse, se muestran pocos elementos y botones Anterior / Siguiente.
 */
import { html, type SafeHtml } from "../core/html";

export interface Page<T> {
  items: T[];
  page: number;
  pages: number;
  total: number;
}

export function paginate<T>(items: readonly T[], page: number, size: number): Page<T> {
  const pages = Math.max(1, Math.ceil(items.length / size));
  const current = Math.min(Math.max(0, page), pages - 1);
  return { items: items.slice(current * size, current * size + size), page: current, pages, total: items.length };
}

/** Controles de página; `key` identifica la lista (data-pager). Vacío si cabe en una página. */
export function pagerMarkup(key: string, page: Page<unknown>): SafeHtml {
  if (page.pages <= 1) return html``;
  return html`
    <nav class="pager" data-pager="${key}" aria-label="Páginas">
      <button class="ghost" type="button" data-page="${page.page - 1}" ${page.page === 0 ? "disabled" : null} aria-label="Página anterior">‹ Anterior</button>
      <span class="pager-info">${page.page + 1} de ${page.pages}</span>
      <button class="ghost" type="button" data-page="${page.page + 1}" ${page.page >= page.pages - 1 ? "disabled" : null} aria-label="Página siguiente">Siguiente ›</button>
    </nav>
  `;
}

/** Lee un clic en los controles de página: { key, page } o null. */
export function pagerClick(event: Event): { key: string; page: number } | null {
  const button = (event.target as HTMLElement).closest<HTMLElement>("[data-page]");
  const nav = button?.closest<HTMLElement>("[data-pager]");
  if (!button || !nav || (button as HTMLButtonElement).disabled) return null;
  return { key: nav.dataset.pager!, page: Number(button.dataset.page) };
}
