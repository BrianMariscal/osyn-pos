import { html, safe, setHtml } from "../core/html";
import { sumCents, toCents, toPesos, fmtMoneyPesos } from "../core/money";
import { ALL_TABS, ROLE_LABELS, TAB_LABELS, type TabId } from "../core/types";
import { normalizeManagerTabs, normalizeVendorTabs } from "../domain/normalize";
import { isRevenueSale } from "../domain/sale-groups";
import { RealtimeSync } from "../data/realtime";
import { syncTablesFor } from "../data/sync-engine";
import { openAssistantChat } from "./assistant-chat";
import { openVoiceSettings } from "./voice-settings";
import { iconFor, TAB_ICONS } from "./icons";
import { initToast } from "./components/toast";
import { closeAllModals, openModal } from "./components/modal";
import { isVoiceEnabled, onVoiceError, setVoiceEnabled } from "./voice-recognition";
import type { AppContext } from "./context";
import { inicioTab } from "./tabs/inicio";
import { ventaTab } from "./tabs/venta";
import { entradasTab } from "./tabs/entradas";
import { productosTab } from "./tabs/productos";
import { inventarioTab } from "./tabs/inventario";
import { mermasTab } from "./tabs/mermas";
import { fiadoTab } from "./tabs/fiado";
import { gastosTab } from "./tabs/gastos";
import { proveedoresTab } from "./tabs/proveedores";
import { corteTab } from "./tabs/corte";
import { reportesTab } from "./tabs/reportes";
import { ajustesTab } from "./tabs/ajustes";

const TAB_MODULES = [inicioTab, ventaTab, entradasTab, productosTab, inventarioTab, mermasTab, fiadoTab, gastosTab, proveedoresTab, corteTab, reportesTab, ajustesTab];

const MORE_ICON = safe('<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><circle cx="5.5" cy="12" r="1.4"/><circle cx="12" cy="12" r="1.4"/><circle cx="18.5" cy="12" r="1.4"/></svg>');

const SESSION_ICON = '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><circle cx="12" cy="8.2" r="3.4"></circle><path d="M5.2 19c1.5-3.1 4-4.7 6.8-4.7s5.3 1.6 6.8 4.7"></path></svg>';

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

export function buildApp(ctx: AppContext): void {
  const root = document.getElementById("app") as HTMLElement;
  setHtml(
    root,
    html`
      <section id="loginScreen" class="login-screen hidden">
        <div class="login-brand">
          <img id="loginLogo" class="login-logo hidden" alt="">
          <div class="login-mark" id="loginMark">A</div>
          <h1 id="loginTitle">Abarrotes POS</h1>
          <p class="hint">Administración de tu tienda</p>
        </div>
        <form id="loginForm" class="card login-card form">
          <label class="form-field">Correo
            <input id="loginEmail" class="input" type="email" autocomplete="username" required>
          </label>
          <label class="form-field">Contraseña
            <span class="pass-field">
              <input id="loginPassword" class="input" type="password" autocomplete="current-password" required>
              <button class="pass-toggle" type="button" data-toggle-pass="loginPassword">Ver</button>
            </span>
          </label>
          <button class="primary" type="submit">Entrar</button>
        </form>
        <div class="login-foot">
          <button class="icon-btn" type="button" data-theme-toggle aria-label="Cambiar tema">☾</button>
        </div>
      </section>
      <div id="appShell" class="hidden">
        <header class="topbar">
          <div class="brand">
            <span class="brand-mark" id="brandMark" aria-hidden="true">T</span>
            <img id="storeLogo" class="store-logo hidden" alt="">
            <h1 id="appTitle">Abarrotes POS</h1>
          </div>
          <div class="top-tools">
            <select id="branchSelect" class="input branch-select" aria-label="Sucursal"></select>
            <span id="branchBadge" class="tag hidden"></span>
            <span class="total-pill" title="Ventas de hoy en esta sucursal (netas de devoluciones)">
              <span class="micro">Hoy</span>
              <strong id="todayTotal">$0.00</strong>
            </span>
            <button id="sessionButton" class="session-chip hidden" type="button" aria-label="Cuenta, sincronización y apariencia">
              <span class="avatar-icon">${safe(SESSION_ICON)}<span id="syncDot" class="sync-dot" data-state="idle"></span></span>
              <span id="sessionName" class="hidden"></span>
            </button>
          </div>
        </header>
        <nav class="tabs" aria-label="Módulos" id="tabsNav"></nav>
        <main id="appMain"></main>
      </div>
      <button id="assistantFab" class="assistant-fab hidden" type="button" aria-label="Asistente IA">
        <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 8V4H8"></path><rect x="4" y="8" width="16" height="12" rx="2"></rect><path d="M2 14h2"></path><path d="M20 14h2"></path><path d="M15 13v2"></path><path d="M9 13v2"></path></svg>
      </button>
      <div id="toastRoot" class="toast" role="status"></div>
    `
  );
  initToast(root.querySelector<HTMLElement>("#toastRoot")!);

  const main = root.querySelector<HTMLElement>("#appMain")!;
  TAB_MODULES.forEach((module) => {
    const section = document.createElement("section");
    section.className = "panel";
    section.id = `panel-${module.id}`;
    main.appendChild(section);
    module.render(section, ctx);
  });

  root.querySelector<HTMLElement>("#tabsNav")!.addEventListener("click", (event) => {
    const target = event.target as HTMLElement;
    const more = target.closest<HTMLElement>("[data-more]");
    if (more) {
      openMoreSheet(ctx);
      return;
    }
    const tab = target.closest<HTMLElement>(".tab");
    if (tab) activateTab(ctx, tab.dataset.tab as TabId);
  });

  document.addEventListener("click", (event) => {
    const shortcut = (event.target as HTMLElement).closest<HTMLElement>("[data-go]");
    if (shortcut) activateTab(ctx, shortcut.dataset.go as TabId);
  });

  wireThemeToggle(ctx);
  wirePasswordToggles();
  wireLogin(ctx);
  wireTopbar(ctx);
  wireSessionMenu(ctx);
  wireSyncListeners(ctx);

  // Si una voz en línea falla (p. ej., plan de ElevenLabs sin acceso a voces
  // de la Biblioteca), se avisa al usuario en vez de fallar en silencio.
  onVoiceError((message) => ctx.toast(message));

  ctx.auth.onSessionChange(() => {
    renderAuthState(ctx);
  });

  // Atajos de la PWA: "?tab=venta" abre la pestaña indicada al iniciar.
  const urlTab = new URLSearchParams(window.location.search).get("tab");
  if (urlTab && (ALL_TABS as readonly string[]).includes(urlTab)) activeTab = urlTab as TabId;

  applyTheme(ctx);
  renderAuthState(ctx);

  // Al activarse un service worker nuevo solo se recarga si el servidor tiene
  // OTRA versión: la página ya se pide a la red al abrir, así que normalmente
  // está al día y no hace falta la recarga (antes se veía la versión vieja y luego la nueva).
  let reloading = false;
  navigator.serviceWorker?.addEventListener?.("controllerchange", () => {
    if (reloading) return;
    void serverVersion().then((version) => {
      if (reloading || !version || version === __APP_VERSION__) return;
      reloading = true;
      window.location.reload();
    });
  });
  void navigator.serviceWorker?.getRegistration?.().then((registration) => {
    if (!registration) return;
    // Una pestaña abierta todo el día no se entera de versiones nuevas: se
    // revisa cada 15 minutos y al volver a la app.
    const check = (): void => {
      void registration.update().catch(() => undefined);
    };
    window.setInterval(check, 15 * 60_000);
    document.addEventListener("visibilitychange", () => {
      if (!document.hidden) check();
    });
    registration.addEventListener("updatefound", () => {
      const installing = registration.installing;
      installing?.addEventListener("statechange", () => {
        if (installing.state !== "installed" || !navigator.serviceWorker.controller) return;
        // Nueva versión descargada: se aplica sola sin esperar al cierre.
        const skip = registration.waiting ?? installing;
        skip?.postMessage?.({ type: "SKIP_WAITING" });
      });
    });
  });
}

const DEFAULT_FAVICON = "/icons/icon.svg";
let faviconSource: string | null = null;

/**
 * Ícono de la pestaña del navegador: el logo de la tienda o el ícono de la app.
 * El logo se reduce a 64×64 (centrado, sin deformar) para no cargar la imagen
 * completa como favicon.
 */
function applyFavicon(logo: string): void {
  if (faviconSource === logo) return;
  faviconSource = logo;
  let link = document.querySelector<HTMLLinkElement>('link[rel="icon"]');
  if (!link) {
    link = document.createElement("link");
    link.rel = "icon";
    document.head.appendChild(link);
  }
  const target = link;
  if (!logo) {
    target.type = "image/svg+xml";
    target.href = DEFAULT_FAVICON;
    return;
  }
  const img = new Image();
  img.onload = () => {
    if (faviconSource !== logo) return;
    const size = 64;
    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;
    const context = canvas.getContext("2d");
    if (!context || !img.naturalWidth || !img.naturalHeight) return;
    const scale = Math.min(size / img.naturalWidth, size / img.naturalHeight);
    const width = img.naturalWidth * scale;
    const height = img.naturalHeight * scale;
    context.drawImage(img, (size - width) / 2, (size - height) / 2, width, height);
    target.type = "image/png";
    target.href = canvas.toDataURL("image/png");
  };
  img.src = logo;
}

const BRAND_KEY = "pos-brand";

function rememberBrand(name: string, logo: string): void {
  try {
    localStorage.setItem(BRAND_KEY, JSON.stringify({ name, logo }));
  } catch {
    /* sin espacio o almacenamiento bloqueado: el login usa la letra */
  }
}

function rememberedBrand(name: string, logo: string): { name: string; logo: string } {
  try {
    const saved = JSON.parse(localStorage.getItem(BRAND_KEY) ?? "null") as { name?: string; logo?: string } | null;
    return { name: name && name !== "Mi tienda" ? name : saved?.name || name, logo: logo || saved?.logo || "" };
  } catch {
    return { name, logo };
  }
}

/** Logo o, si no hay o la imagen falla, la inicial de la tienda. */
function showLogo(imgId: string, markId: string, logo: string, name: string): void {
  const img = document.getElementById(imgId) as HTMLImageElement | null;
  const mark = document.getElementById(markId);
  if (mark) mark.textContent = name.trim().charAt(0).toUpperCase() || "A";
  const fallback = (): void => {
    img?.classList.add("hidden");
    mark?.classList.remove("hidden");
  };
  if (!img || !logo) {
    fallback();
    return;
  }
  img.onerror = fallback;
  img.onload = () => {
    img.classList.remove("hidden");
    mark?.classList.add("hidden");
  };
  img.alt = name;
  if (img.getAttribute("src") !== logo) img.src = logo;
  else if (img.complete && img.naturalWidth) img.onload(new Event("load"));
}

function wireThemeToggle(ctx: AppContext): void {
  document.addEventListener("click", (event) => {
    const button = (event.target as HTMLElement).closest<HTMLElement>("[data-theme-toggle]");
    if (!button) return;
    const dark = document.documentElement.dataset.theme === "dark";
    setThemeChoice(ctx, dark ? "light" : "dark");
  });
}

function wirePasswordToggles(): void {
  document.addEventListener("click", (event) => {
    const toggle = (event.target as HTMLElement).closest<HTMLElement>("[data-toggle-pass]");
    if (!toggle) return;
    const input = document.getElementById(toggle.dataset.togglePass ?? "") as HTMLInputElement | null;
    if (!input) return;
    const show = input.type === "password";
    input.type = show ? "text" : "password";
    toggle.textContent = show ? "Ocultar" : "Ver";
    input.focus();
  });
}

function wireLogin(ctx: AppContext): void {
  const form = document.getElementById("loginForm") as HTMLFormElement | null;
  form?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const email = (document.getElementById("loginEmail") as HTMLInputElement).value.trim();
    const password = (document.getElementById("loginPassword") as HTMLInputElement).value;
    const button = form.querySelector<HTMLButtonElement>("button[type=submit]")!;
    button.disabled = true;
    try {
      await ctx.auth.login(email, password);
      (document.getElementById("loginPassword") as HTMLInputElement).value = "";
      ctx.toast("Sesión iniciada");
      // Recarga con el snapshot y la cola offline aislados para este usuario.
      window.location.reload();
    } catch (error) {
      ctx.toast(error instanceof Error ? error.message : "No se pudo iniciar sesión");
    } finally {
      button.disabled = false;
    }
  });
}

function wireTopbar(ctx: AppContext): void {
  const branchSelect = document.getElementById("branchSelect") as HTMLSelectElement;
  branchSelect.addEventListener("change", () => {
    ctx.branches.setOperational(branchSelect.value);
  });

  document.getElementById("topLogoutButton")?.addEventListener("click", () => {
    void ctx.auth.logout().then(() => window.location.reload());
  });

  ctx.store.watch((s) => s.settings, (settings) => {
    // Con sesión se recuerda la marca en el dispositivo; sin sesión (login)
    // se usa la recordada, porque los ajustes del invitado vienen vacíos.
    if (ctx.auth.isAuthenticated) rememberBrand(settings.storeName, settings.logo);
    const brand = ctx.auth.isAuthenticated ? { name: settings.storeName, logo: settings.logo } : rememberedBrand(settings.storeName, settings.logo);
    const name = brand.name || "Abarrotes POS";
    document.title = name;
    const title = document.getElementById("appTitle");
    if (title) title.textContent = name;
    const loginTitle = document.getElementById("loginTitle");
    if (loginTitle) loginTitle.textContent = name;
    showLogo("loginLogo", "loginMark", brand.logo, name);
    showLogo("storeLogo", "brandMark", brand.logo, name);
    applyFavicon(brand.logo);
    applyTheme(ctx);
    renderTabsNav(ctx);
  });

  const renderSyncDot = (): void => {
    const status = syncStatus(ctx);
    const dot = document.getElementById("syncDot");
    const button = document.getElementById("sessionButton");
    if (dot) dot.dataset.state = status.state;
    if (button) button.title = `${status.label}${status.detail ? ` · ${status.detail}` : ""}`;
  };
  ctx.store.watch((s) => s.sync, renderSyncDot);
  window.addEventListener("online", renderSyncDot);
  window.addEventListener("offline", renderSyncDot);
  // Tema automático: sigue al sistema si cambia mientras la app está abierta
  window.matchMedia?.("(prefers-color-scheme: dark)").addEventListener?.("change", () => applyTheme(ctx));

  ctx.store.watch(
    (s) => [s.sales, s.returns, s.branches, s.currentBranchId] as const,
    () => {
      const branchId = ctx.branches.operationalId();
      const start = new Date();
      start.setHours(0, 0, 0, 0);
      const end = new Date(start);
      end.setDate(end.getDate() + 1);
      const startISO = start.toISOString();
      const endISO = end.toISOString();
      let totalCents = sumCents(
        ctx.repos.sales
          .list()
          .filter((sale) => sale.branch_id === branchId && isRevenueSale(sale) && sale.created_at >= startISO && sale.created_at < endISO)
          .map((sale) => toCents(sale.total))
      );
      // Las devoluciones de hoy bajan el total del pill "Hoy".
      totalCents -= sumCents(
        ctx.repos.returns
          .list()
          .filter((ret) => ret.branch_id === branchId && ret.created_at >= startISO && ret.created_at < endISO)
          .map((ret) => toCents(ret.total))
      );
      const el = document.getElementById("todayTotal");
      if (el) el.textContent = fmtMoneyPesos(toPesos(totalCents));
    }
  );

  ctx.store.watch(
    (s) => [s.branches, s.currentBranchId] as const,
    () => {
      const assigned = ctx.auth.isAuthenticated ? ctx.auth.assignedBranchId() : null;
      const isAdmin = ctx.auth.isAuthenticated ? ctx.auth.isAdmin() : false;
      const badge = document.getElementById("branchBadge");
      // Vendedor o administrador asignado a una sucursal: solo la suya, sin selector
      if (!isAdmin || assigned) {
        branchSelect.classList.add("hidden");
        const branchId = assigned;
        if (badge) {
          badge.textContent = branchId ? ctx.branches.name(branchId) : "Sin sucursal";
          badge.classList.remove("hidden");
        }
        return;
      }
      if (badge) badge.classList.add("hidden");
      const branches = ctx.branches.list();
      // Con una sola sucursal no hay nada que elegir: se oculta el selector.
      branchSelect.classList.toggle("hidden", branches.length <= 1);
      setHtml(
        branchSelect,
        html`${branches.map((branch) => html`<option value="${branch.id}">${branch.name}</option>`)}`
      );
      branchSelect.value = ctx.branches.operationalId();
    }
  );
}

type SyncState = "ok" | "pending" | "offline" | "error" | "idle";

/** Estado de sincronización legible (punto del avatar y menú de cuenta). */
function syncStatus(ctx: AppContext): { state: SyncState; label: string; detail: string } {
  const sync = ctx.store.getState().sync;
  const time = (iso: string | null) =>
    iso ? new Date(iso).toLocaleTimeString("es-MX", { hour: "2-digit", minute: "2-digit" }) : "";
  const pending = sync.pending === 1 ? "1 cambio pendiente" : `${sync.pending} cambios pendientes`;
  if (!ctx.auth.isAuthenticated) return { state: "idle", label: "Sin sesión", detail: "" };
  if (!navigator.onLine) return { state: "offline", label: "Sin internet", detail: sync.pending ? `${pending}; se suben al volver la conexión` : "Puedes seguir vendiendo" };
  if (sync.error) return { state: "error", label: "No se pudo sincronizar", detail: friendlySyncError(sync.error) };
  if (sync.pending) return { state: "pending", label: "Sincronizando…", detail: pending };
  if (sync.lastSyncAt) return { state: "ok", label: "Todo sincronizado", detail: `Última vez ${time(sync.lastSyncAt)}` };
  return { state: "idle", label: "Conectando…", detail: "" };
}

/** Versión publicada en el servidor (null sin conexión). */
async function serverVersion(): Promise<string | null> {
  try {
    const res = await fetch(`/version.json?t=${Date.now()}`, { cache: "no-store" });
    if (!res.ok) return null;
    return ((await res.json()) as { version?: string }).version ?? null;
  } catch {
    return null;
  }
}

/**
 * Busca una versión nueva de la app. Si hay, se instala y la página se recarga
 * sola (controllerchange). Devuelve true si encontró una.
 */
async function checkForUpdate(): Promise<boolean> {
  const latest = await serverVersion();
  if (latest && latest !== __APP_VERSION__) {
    const registration = await navigator.serviceWorker?.getRegistration?.();
    await registration?.update().catch(() => undefined);
    window.setTimeout(() => window.location.reload(), 600);
    return true;
  }
  const registration = await navigator.serviceWorker?.getRegistration?.();
  if (!registration) return false;
  await registration.update().catch(() => undefined);
  const waiting = registration.waiting ?? registration.installing;
  if (waiting) {
    waiting.postMessage({ type: "SKIP_WAITING" });
    // Respaldo por si el cambio de versión no dispara la recarga
    window.setTimeout(() => window.location.reload(), 4000);
    return true;
  }
  return false;
}

type ThemeChoice = "light" | "dark" | "auto";
const THEME_KEY = "pos-theme";

/** El tema es preferencia de cada dispositivo (antes viajaba en los ajustes y cambiaba el de todos). */
function themeChoice(ctx: AppContext): ThemeChoice {
  try {
    const local = localStorage.getItem(THEME_KEY);
    if (local === "light" || local === "dark" || local === "auto") return local;
  } catch {
    /* almacenamiento no disponible */
  }
  return ctx.store.getState().settings.theme ?? "auto";
}

function setThemeChoice(ctx: AppContext, choice: ThemeChoice): void {
  try {
    localStorage.setItem(THEME_KEY, choice);
  } catch {
    /* almacenamiento no disponible */
  }
  applyTheme(ctx);
}

const svg = (body: string) =>
  safe(`<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`);
const THEME_OPTIONS = [
  { id: "light", label: "Claro", icon: svg('<circle cx="12" cy="12" r="4"/><path d="M12 2.5v2M12 19.5v2M4.6 4.6 6 6M18 18l1.4 1.4M2.5 12h2M19.5 12h2M4.6 19.4 6 18M18 6l1.4-1.4"/>') },
  { id: "dark", label: "Oscuro", icon: svg('<path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5Z"/>') },
  { id: "auto", label: "Auto", icon: svg('<rect x="3" y="4.5" width="18" height="12" rx="2"/><path d="M8.5 20h7M12 16.5V20"/>') }
] as const satisfies ReadonlyArray<{ id: ThemeChoice; label: string; icon: ReturnType<typeof safe> }>;

/** Mensajes de error de red legibles. */
function friendlySyncError(error: string): string {
  if (/failed to fetch|networkerror|load failed|network request failed/i.test(error)) return "No hay conexión con el servidor. Se reintentará solo.";
  if (/jwt|401|token/i.test(error)) return "La sesión expiró. Cierra sesión y vuelve a entrar.";
  return error;
}

function wireSessionMenu(ctx: AppContext): void {
  document.getElementById("assistantFab")?.addEventListener("click", () => openAssistantChat(ctx));
  document.getElementById("sessionButton")?.addEventListener("click", () => {
    const session = ctx.auth.session;
    if (!session) return;
    let stopWatch: (() => void) | null = null;
    openModal({
      title: ctx.auth.displayName() || "Cuenta",
      content: html`
        <p class="muted">${session.user?.email ?? ""} · ${ROLE_LABELS[session.role] ?? ""}</p>
        <section class="menu-section">
          <p class="micro">Sincronización</p>
          <div class="sync-card" id="menuSync"></div>
        </section>
        <section class="menu-section">
          <p class="micro">Apariencia</p>
          <div class="segmented" role="radiogroup" aria-label="Tema" id="menuTheme">
            ${THEME_OPTIONS.map(
              (option) => html`<button type="button" role="radio" data-theme-choice="${option.id}">${option.icon}<span>${option.label}</span></button>`
            )}
          </div>
        </section>
        <section class="menu-section">
          <p class="micro">Asistente</p>
          <div class="more-list">
            <button class="ghost more-item" type="button" data-menu="voice">Voz del asistente: ${isVoiceEnabled() ? "activada" : "desactivada"}</button>
            <button class="ghost more-item" type="button" data-menu="voiceconfig">Elegir voz…</button>
          </div>
        </section>
        <section class="menu-section">
          <p class="micro">Aplicación</p>
          <div class="sync-card">
            <span class="sync-dot sync-dot-lg" data-state="ok"></span>
            <div class="sync-text"><strong>Versión ${__APP_VERSION__}</strong><span class="muted" id="menuUpdateText">Se actualiza sola al haber cambios</span></div>
            <button class="ghost sync-now" type="button" data-menu-update>Buscar actualización</button>
          </div>
        </section>
        <button class="ghost more-item danger-item" type="button" data-menu="logout">Cerrar sesión</button>
      `,
      onOpen: (root, close) => {
        const syncEl = root.querySelector<HTMLElement>("#menuSync")!;
        const themeEl = root.querySelector<HTMLElement>("#menuTheme")!;
        let syncing = false;
        const renderSync = (): void => {
          const status = syncStatus(ctx);
          setHtml(
            syncEl,
            html`<span class="sync-dot sync-dot-lg" data-state="${syncing ? "pending" : status.state}"></span>
              <div class="sync-text"><strong>${syncing ? "Sincronizando…" : status.label}</strong>${status.detail ? html`<span class="muted">${status.detail}</span>` : html``}</div>
              <button class="ghost sync-now" type="button" data-sync-now ${syncing || !navigator.onLine ? "disabled" : null}>Sincronizar</button>`
          );
        };
        const renderTheme = (): void => {
          const current = themeChoice(ctx);
          themeEl.querySelectorAll<HTMLElement>("[data-theme-choice]").forEach((button) => {
            const active = button.dataset.themeChoice === current;
            button.classList.toggle("active", active);
            button.setAttribute("aria-checked", String(active));
          });
        };
        stopWatch = ctx.store.watch((s) => s.sync, renderSync);
        renderTheme();
        // Al cerrar (X, fondo o Escape) se deja de escuchar el estado de sync
        const observer = new MutationObserver(() => {
          if (!root.isConnected) {
            stopWatch?.();
            observer.disconnect();
          }
        });
        observer.observe(document.body, { childList: true });

        syncEl.addEventListener("click", (event) => {
          if (!(event.target as HTMLElement).closest("[data-sync-now]") || syncing) return;
          syncing = true;
          renderSync();
          void ctx.sync.syncNow().then((result) => {
            syncing = false;
            renderSync();
            ctx.toast(result.ok ? "Sincronizado" : friendlySyncError(result.error ?? "No se pudo sincronizar"));
          });
        });
        root.querySelector<HTMLElement>("[data-menu-update]")!.addEventListener("click", (event) => {
          const button = event.currentTarget as HTMLButtonElement;
          const text = root.querySelector<HTMLElement>("#menuUpdateText")!;
          button.disabled = true;
          text.textContent = "Buscando…";
          void checkForUpdate().then((found) => {
            button.disabled = false;
            text.textContent = found ? "Instalando la versión nueva…" : "Ya tienes la versión más reciente";
          });
        });
        themeEl.addEventListener("click", (event) => {
          const button = (event.target as HTMLElement).closest<HTMLElement>("[data-theme-choice]");
          if (!button) return;
          setThemeChoice(ctx, button.dataset.themeChoice as ThemeChoice);
          renderTheme();
        });
        root.querySelectorAll<HTMLElement>("[data-menu]").forEach((button) => {
          button.addEventListener("click", () => {
            const action = button.dataset.menu;
            close();
            if (action === "voice") {
              setVoiceEnabled(!isVoiceEnabled());
              ctx.toast(`Voz del asistente ${isVoiceEnabled() ? "activada" : "desactivada"}`);
            }
            if (action === "voiceconfig") openVoiceSettings();
            if (action === "logout") void ctx.auth.logout().then(() => window.location.reload());
          });
        });
      }
    });
  });
}

function wireSyncListeners(ctx: AppContext): void {
  ctx.tracker.addListener(() => {
    ctx.store.update((state) => {
      state.sync = { ...state.sync, pending: ctx.tracker.pendingCount() };
    });
    ctx.sync.schedule();
  });
  window.addEventListener("online", () => {
    void ctx.sync.syncNow({ quiet: true });
  });
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden && ctx.auth.isAuthenticated) ctx.sync.schedule(100);
  });
  window.addEventListener("focus", () => {
    if (ctx.auth.isAuthenticated) ctx.sync.schedule(100);
  });

  // Tiempo real: cualquier cambio en otro dispositivo dispara la sync al
  // instante. Si Realtime no está disponible, queda la revisión periódica.
  const realtime = new RealtimeSync({
    supabaseUrl: ctx.config.supabaseUrl,
    apiKey: ctx.config.supabaseKey,
    token: () => ctx.auth.session?.access_token ?? null,
    tables: () => syncTablesFor(ctx.auth.isAdmin(), ctx.store.getState().settings.vendorTabs),
    onChange: () => {
      if (ctx.auth.isAuthenticated) ctx.sync.schedule(300);
    }
  });
  const realtimeOn = (): void => {
    if (ctx.client.configured && ctx.auth.isAuthenticated && !document.hidden) realtime.start();
  };
  realtimeOn();
  ctx.auth.onSessionChange(() => {
    if (ctx.auth.isAuthenticated) {
      realtime.refreshToken();
      realtimeOn();
    } else {
      realtime.stop();
    }
  });
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) realtime.stop();
    else realtimeOn();
  });
  window.addEventListener("online", realtimeOn);

  // Respaldo: cada 8 s sin tiempo real; cada 60 s si el tiempo real está activo.
  let lastPoll = 0;
  window.setInterval(() => {
    if (document.hidden || !ctx.auth.isAuthenticated || !navigator.onLine) return;
    realtime.refreshToken();
    if (realtime.isLive && Date.now() - lastPoll < 60_000) return;
    lastPoll = Date.now();
    void ctx.sync.syncNow({ quiet: true });
  }, 8000);
}

function openMoreSheet(ctx: AppContext): void {
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

function allowedTabsChanged(ctx: AppContext): void {
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

function renderTabsNav(ctx: AppContext): void {
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

function renderAuthState(ctx: AppContext): void {
  const loggedIn = ctx.auth.isAuthenticated;
  document.getElementById("loginScreen")?.classList.toggle("hidden", loggedIn);
  document.getElementById("appShell")?.classList.toggle("hidden", !loggedIn);
  if (!loggedIn) {
    closeAllModals();
    return;
  }
  ctx.branches.ensureSeeded();
  renderTabsNav(ctx);
  allowedTabsChanged(ctx);
  activateTab(ctx, activeTab);
  const avatar = document.getElementById("sessionButton");
  if (avatar) avatar.classList.remove("hidden");
  const sessionName = document.getElementById("sessionName");
  if (sessionName) {
    const name = ctx.auth.displayName();
    sessionName.textContent = name;
    sessionName.classList.toggle("hidden", !name);
  }
  // El asistente SIEMPRE está disponible con sesión: en iPhone no hay dictado
  // (Web Speech API) y el chat funciona escribiendo; solo el micrófono se oculta.
  document.getElementById("assistantFab")?.classList.toggle("hidden", !ctx.auth.isAuthenticated);
  void ctx.sync.syncNow({ quiet: true });
}

export function applyTheme(ctx: AppContext): void {
  const preference = themeChoice(ctx);
  const dark = preference === "dark" || (preference === "auto" && window.matchMedia?.("(prefers-color-scheme: dark)").matches);
  document.documentElement.dataset.theme = dark ? "dark" : "light";
  const meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
  if (meta) meta.content = dark ? "#161b22" : "#ffffff";
  document.querySelectorAll<HTMLElement>("[data-theme-toggle]").forEach((button) => {
    button.textContent = dark ? "☀" : "☾";
  });
}
