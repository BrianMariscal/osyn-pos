/**
 * Sub-pestañas dentro de una pestaña: muestra una sección a la vez para no
 * tener que desplazarse por formularios e historiales apilados.
 * - always: también en computadora (Proveedores).
 * - si no: solo en celular; en computadora las secciones van lado a lado.
 */
import { html, setHtml } from "../core/html";

export interface SectionDef {
  id: string;
  label: string;
  el: HTMLElement | null;
}

export interface Sections {
  show(id: string): void;
  current(): string;
}

export function mountSections(
  root: HTMLElement,
  defs: SectionDef[],
  options: { always?: boolean; onShow?: (id: string) => void } = {}
): Sections {
  const sections = defs.filter((def): def is SectionDef & { el: HTMLElement } => Boolean(def.el));
  const nav = document.createElement("nav");
  nav.className = `subtabs ${options.always ? "subtabs-always" : ""}`;
  nav.setAttribute("aria-label", "Secciones");
  setHtml(
    nav,
    html`${sections.map((def) => html`<button type="button" data-section-tab="${def.id}">${def.label}</button>`)}`
  );
  root.prepend(nav);
  root.classList.add("has-sections");
  if (options.always) root.classList.add("sections-always");
  sections.forEach((def) => {
    def.el.dataset.section = def.id;
  });

  let current = sections[0]?.id ?? "";
  const show = (id: string): void => {
    if (!sections.some((def) => def.id === id)) return;
    current = id;
    sections.forEach((def) => def.el.classList.toggle("section-on", def.id === id));
    nav.querySelectorAll<HTMLElement>("[data-section-tab]").forEach((button) => {
      const on = button.dataset.sectionTab === id;
      button.classList.toggle("active", on);
      button.setAttribute("aria-current", on ? "true" : "false");
    });
  };
  nav.addEventListener("click", (event) => {
    const button = (event.target as HTMLElement).closest<HTMLElement>("[data-section-tab]");
    if (!button) return;
    show(button.dataset.sectionTab!);
    options.onShow?.(button.dataset.sectionTab!);
    root.scrollIntoView({ block: "start" });
    window.scrollTo({ top: 0 });
  });
  show(current);
  return { show, current: () => current };
}
