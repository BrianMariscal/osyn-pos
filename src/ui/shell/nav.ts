import { html, safe, setHtml } from "../../core/html";
import { ALL_TABS, ROLE_LABELS, TAB_LABELS, type TabId } from "../../core/types";
import { normalizeManagerTabs, normalizeVendorTabs } from "../../domain/normalize";
import { openAssistantChat } from "../assistant-chat";
import { openModal } from "../components/modal";
import { iconFor, TAB_ICONS } from "../icons";
import type { AppContext } from "../context";

const MORE_ICON = safe('<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><circle cx="5.5" cy="12" r="1.4"/><circle cx="12" cy="12" r="1.4"/><circle cx="18.5" cy="12" r="1.4"/></svg>');

/** Pestañas fijas de operación (dueño/admin): el resto se abre en el panel "Más". */
const NAV_PRIMARY: readonly TabId[] = ["inicio", "venta", "fiado", "corte"];

/** Agrupación del panel "Más" para dueño/administrador. */
const MORE_GROUPS: Array<{ label: string; tabs: readonly TabId[] }> = [
  { label: "Mercancía", tabs: ["entradas", "productos", "inventario", "mermas"] },
  { label: "Compras y gastos", tabs: ["gastos", "proveedores"] },
  { label: "Control", tabs: ["reportes", "ajustes"] }
];

/** Color de cada sección en la navegación. */
const TAB_TONES: Partial<Record<TabId, string>> = {
  inicio: "--c-blue",
  venta: "--c-green",
  fiado: "--c-amber",
  corte: "--c-violet",
  entradas: "--c-teal",
  productos: "--c-blue",
  inventario: "--c-teal",
  mermas: "--c-coral",
  gastos: "--c-coral",
  proveedores: "--c-violet",
  reportes: "--c-blue"
};

let activeTab: TabId = "inicio";

/** Fija la pestaña inicial (p. ej. "?tab=venta") antes del primer render. */
export function presetActiveTab(tab: TabId): void {
  activeTab = tab;
}

/** Vuelve a aplicar la pestaña activa (al iniciar sesión o cambiar permisos). */
export function refreshActiveTab(ctx: AppContext): void {
  activateTab(ctx, activeTab);
}

function allowedTabs(ctx: AppContext): TabId[] {
  const settings = ctx.store.getState().settings;
  if (ctx.auth.isOwner()) return [...ALL_TABS];
  if (ctx.auth.isAdmin()) return normalizeManagerTabs(settings.adminTabs);
  return normalizeVendorTabs(settings.vendorTabs);
}

/** Etiquetas que solo cambian para el vendedor: entradas se lee "Recibir mercancía". */
const VENDOR_TAB_LABELS: Partial<Record<TabId, string>> = { entradas: "Recibir mercancía" };

function tabLabel(ctx: AppContext, tab: TabId): string {
  if (!ctx.auth.isAdmin() && VENDOR_TAB_LABELS[tab]) return VENDOR_TAB_LABELS[tab]!;
  return TAB_LABELS[tab];
}

function splitNav(ctx: AppContext, allowed: TabId[]): { primary: TabId[]; overflow: TabId[] } {
  // Dueño, administrador y vendedor: inicio, venta, fiado y corte fijas;
  // el resto se abre en el panel "Más".
  const primary: TabId[] = [];
  for (const tab of NAV_PRIMARY) {
    if (primary.length >= 4) break;
    if (allowed.includes(tab)) primary.push(tab);
  }
  for (const tab of allowed) {
    if (primary.length >= 4) break;
    if (!primary.includes(tab)) primary.push(tab);
  }
  return { primary, overflow: allowed.filter((tab) => !primary.includes(tab)) };
}

export function openMoreSheet(ctx: AppContext): void {
  const allowed = allowedTabs(ctx);
  const { primary, overflow } = splitNav(ctx, allowed);
  const session = ctx.auth.session;
  const sections = MORE_GROUPS.map((group) => ({
    label: group.label,
    tabs: group.tabs.filter((tab) => allowed.includes(tab) && !primary.includes(tab))
  })).filter((section) => section.tabs.length);
  const leftover = overflow.filter((tab) => !sections.some((section) => section.tabs.includes(tab)));
  openModal({
    title: "Más secciones",
    content: html`
      ${session ? html`<p class="muted">${ctx.auth.displayName()} · ${ROLE_LABELS[session.role] ?? ""}</p>` : html``}
      <div class="more-list">
        <button class="ghost more-item more-assistant" type="button" data-more-assistant>Asistente de la tienda</button>
        ${sections.map(
          (section) => html`<p class="micro more-group-label">${section.label}</p>
            ${section.tabs.map((tab) => html`<button class="ghost more-item" type="button" data-tab="${tab}">${tabLabel(ctx, tab)}</button>`)}`
        )}
        ${leftover.length
          ? html`<p class="micro more-group-label">Otros</p>
              ${leftover.map((tab) => html`<button class="ghost more-item" type="button" data-tab="${tab}">${tabLabel(ctx, tab)}</button>`)}`
          : html``}
      </div>
    `,
    onOpen: (root, close) => {
      root.querySelector<HTMLElement>("[data-more-assistant]")?.addEventListener("click", () => {
        close();
        openAssistantChat(ctx);
      });
      root.querySelectorAll<HTMLElement>("[data-tab]").forEach((button) => {
        button.addEventListener("click", () => {
          close();
          activateTab(ctx, button.dataset.tab as TabId);
        });
      });
    }
  });
}

export function activateTab(ctx: AppContext, tabName: TabId | undefined): void {
  if (!tabName) return;
  const allowed = allowedTabs(ctx);
  const target = allowed.includes(tabName) ? tabName : allowed[0]!;
  activeTab = target;
  document.querySelectorAll<HTMLElement>(".tab").forEach((tab) => {
    const isMore = tab.dataset.more !== undefined;
    tab.classList.toggle("active", isMore ? allowed.includes(activeTab) && !splitNav(ctx, allowed).primary.includes(activeTab) : tab.dataset.tab === activeTab);
  });
  document.querySelectorAll<HTMLElement>(".panel").forEach((panel) => {
    panel.classList.toggle("active", panel.id === `panel-${target}`);
  });
  // Avisa a los módulos (p. ej. Ajustes) para que refresquen datos de red al
  // ser mostrados de nuevo, sin necesidad de recargar la página.
  document.dispatchEvent(new CustomEvent("pos-tab-active", { detail: target }));
}

export function allowedTabsChanged(ctx: AppContext): void {
  const allowed = allowedTabs(ctx);
  document.querySelectorAll<HTMLElement>(".tab").forEach((tab) => {
    const id = tab.dataset.tab as TabId | undefined;
    if (!id) return;
    tab.classList.toggle("hidden", !allowed.includes(id));
  });
  document.querySelectorAll<HTMLElement>("[data-go]").forEach((button) => {
    const id = (button as HTMLElement).dataset.go as TabId;
    button.classList.toggle("hidden", !allowed.includes(id));
  });
  document.querySelectorAll<HTMLElement>(".panel").forEach((panel) => {
    const id = panel.id.replace("panel-", "") as TabId;
    panel.classList.toggle("hidden", !allowed.includes(id));
  });
  if (!allowed.includes(activeTab)) activateTab(ctx, allowed[0]);
}

export function renderTabsNav(ctx: AppContext): void {
  const nav = document.getElementById("tabsNav");
  if (!nav) return;
  const allowed = allowedTabs(ctx);
  const { primary, overflow } = splitNav(ctx, allowed);
  nav.classList.toggle("tabs-vendor", !ctx.auth.isAdmin());
  const tabButton = (tab: TabId) =>
    html`<button class="tab nav-primary ${tab === activeTab ? "active" : ""}" type="button" data-tab="${tab}" style="--tab-color: var(${TAB_TONES[tab] ?? "--primary"})"><span class="tab-ico">${iconFor(TAB_ICONS[tab]!)}</span><span>${tabLabel(ctx, tab)}</span></button>`;
  setHtml(
    nav,
    html`${primary.map((tab) => tabButton(tab))}
    ${overflow.length ? html`<button class="tab nav-primary nav-more ${overflow.includes(activeTab) ? "active" : ""}" type="button" data-more="1"><span class="tab-ico">${MORE_ICON}</span><span>Más</span></button>` : html``}`
  );
}
