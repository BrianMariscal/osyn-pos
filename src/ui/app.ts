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
import { isVoiceEnabled, setVoiceEnabled } from "./voice-recognition";
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
            <span id="connectionTag" class="tag" title="Sincronizando…"><span class="dot"></span><span id="connectionBadgeText" class="tag-label-sync"></span></span>
            <button class="icon-btn theme-toggle" type="button" data-theme-toggle aria-label="Cambiar tema">☾</button>
            <span class="total-pill" title="Ventas de hoy en esta sucursal">
              <span class="micro">Hoy</span>
              <strong id="todayTotal">$0.00</strong>
            </span>
            <button id="sessionButton" class="session-chip hidden" type="button" aria-label="Cuenta">
              <span class="avatar-icon">${safe(SESSION_ICON)}</span>
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

  ctx.auth.onSessionChange(() => {
    renderAuthState(ctx);
  });

  // Atajos de la PWA: "?tab=venta" abre la pestaña indicada al iniciar.
  const urlTab = new URLSearchParams(window.location.search).get("tab");
  if (urlTab && (ALL_TABS as readonly string[]).includes(urlTab)) activeTab = urlTab as TabId;

  applyTheme(ctx);
  renderAuthState(ctx);

  let reloading = false;
  navigator.serviceWorker?.addEventListener?.("controllerchange", () => {
    if (reloading) return;
    reloading = true;
    window.location.reload();
  });
  void navigator.serviceWorker?.getRegistration?.().then((registration) => {
    if (!registration) return;
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

function wireThemeToggle(ctx: AppContext): void {
  document.addEventListener("click", (event) => {
    const button = (event.target as HTMLElement).closest<HTMLElement>("[data-theme-toggle]");
    if (!button) return;
    const current = ctx.store.getState().settings.theme ?? "auto";
    const resolved =
      current === "auto"
        ? (window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light")
        : current;
    ctx.settings.save({ theme: resolved === "dark" ? "light" : "dark" });
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
    document.title = settings.storeName || "Abarrotes POS";
    const title = document.getElementById("appTitle");
    if (title) title.textContent = settings.storeName || "Abarrotes POS";
    const loginTitle = document.getElementById("loginTitle");
    if (loginTitle) loginTitle.textContent = settings.storeName || "Abarrotes POS";
    const loginMark = document.getElementById("loginMark");
    if (loginMark) {
      loginMark.textContent = (settings.storeName || "Abarrotes").trim().charAt(0).toUpperCase();
      // Con logo propio la letra sobra: se oculta igual que la marca del header
      loginMark.classList.toggle("hidden", Boolean(settings.logo));
    }
    const loginLogo = document.getElementById("loginLogo") as HTMLImageElement | null;
    if (loginLogo) {
      loginLogo.classList.toggle("hidden", !settings.logo);
      if (settings.logo) loginLogo.src = settings.logo;
    }
    const brandMark = document.getElementById("brandMark");
    if (brandMark) {
      brandMark.textContent = (settings.storeName || "A").trim().charAt(0).toUpperCase();
      brandMark.classList.toggle("hidden", Boolean(settings.logo));
    }
    const logo = document.getElementById("storeLogo") as HTMLImageElement | null;
    if (logo) {
      logo.classList.toggle("hidden", !settings.logo);
      if (settings.logo) {
        logo.src = settings.logo;
        logo.alt = settings.storeName || "Logo";
      }
    }
    applyTheme(ctx);
    renderTabsNav(ctx);
  });

  ctx.store.watch((s) => s.sync, (sync) => {
    const badge = document.getElementById("connectionBadgeText");
    const tag = document.getElementById("connectionTag");
    if (!badge || !tag) return;
    tag.classList.remove("tag-error", "tag-off");
    if (!ctx.auth.isAuthenticated) {
      badge.textContent = "Sin sesión";
      tag.classList.add("tag-off");
      tag.title = "";
    } else if (sync.error) {
      badge.textContent = "Error de sync";
      tag.classList.add("tag-error");
      tag.title = sync.error;
    } else if (!navigator.onLine) {
      badge.textContent = `${sync.pending} pendientes`;
      tag.classList.add("tag-off");
      tag.title = "Sin internet";
    } else if (sync.pending) {
      badge.textContent = `${sync.pending} pendientes`;
      tag.title = "Cambios por sincronizar";
    } else if (sync.lastSyncAt) {
      // Solo el punto verde; el detalle va en el tooltip
      badge.textContent = "";
      tag.title = `Sincronizado ${new Date(sync.lastSyncAt).toLocaleTimeString("es-MX", { hour: "2-digit", minute: "2-digit" })}`;
    } else {
      badge.textContent = "";
      tag.title = "Sincronizando…";
    }
  });

  ctx.store.watch(
    (s) => [s.sales, s.branches, s.currentBranchId] as const,
    () => {
      const branchId = ctx.branches.operationalId();
      const start = new Date();
      start.setHours(0, 0, 0, 0);
      const end = new Date(start);
      end.setDate(end.getDate() + 1);
      const totalCents = sumCents(
        ctx.repos.sales
          .list()
          .filter((sale) => sale.branch_id === branchId && isRevenueSale(sale) && sale.created_at >= start.toISOString() && sale.created_at < end.toISOString())
          .map((sale) => toCents(sale.total))
      );
      const el = document.getElementById("todayTotal");
      if (el) el.textContent = fmtMoneyPesos(toPesos(totalCents));
    }
  );

  ctx.store.watch(
    (s) => [s.branches, s.currentBranchId] as const,
    () => {
      const isAdmin = ctx.auth.isAuthenticated ? ctx.auth.isAdmin() : false;
      const badge = document.getElementById("branchBadge");
      if (!isAdmin) {
        branchSelect.classList.add("hidden");
        const branchId = ctx.auth.employeeBranchId();
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

function wireSessionMenu(ctx: AppContext): void {
  document.getElementById("assistantFab")?.addEventListener("click", () => openAssistantChat(ctx));
  document.getElementById("sessionButton")?.addEventListener("click", () => {
    const session = ctx.auth.session;
    if (!session) return;
    openModal({
      title: ctx.auth.displayName() || "Cuenta",
      content: html`
        <p class="muted">${session.user?.email ?? ""} · ${ROLE_LABELS[session.role] ?? ""}</p>
        <div class="more-list">
          <button class="ghost more-item" type="button" data-menu="voice">Voz del asistente: ${isVoiceEnabled() ? "activada" : "desactivada"}</button>
          <button class="ghost more-item" type="button" data-menu="voiceconfig">Elegir voz…</button>
          <button class="ghost more-item danger-item" type="button" data-menu="logout">Cerrar sesión</button>
        </div>
      `,
      onOpen: (root, close) => {
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
  ctx.tracker.onChange = () => {
    ctx.store.update((state) => {
      state.sync = { ...state.sync, pending: ctx.tracker.pendingCount() };
    });
    ctx.sync.schedule();
  };
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
    html`<button class="tab nav-primary ${tab === activeTab ? "active" : ""}" type="button" data-tab="${tab}" style="--tab-color: var(--primary)"><span class="tab-ico">${iconFor(TAB_ICONS[tab]!)}</span><span>${tabLabel(ctx, tab)}</span></button>`;
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
  const preference = ctx.store.getState().settings.theme ?? "auto";
  const dark = preference === "dark" || (preference === "auto" && window.matchMedia?.("(prefers-color-scheme: dark)").matches);
  document.documentElement.dataset.theme = dark ? "dark" : "light";
  const meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
  if (meta) meta.content = dark ? "#101820" : "#eef3f8";
  document.querySelectorAll<HTMLElement>("[data-theme-toggle]").forEach((button) => {
    button.textContent = dark ? "☀" : "☾";
  });
}
