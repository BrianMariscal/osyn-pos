import { html, safe, setHtml } from "../core/html";
import { ALL_TABS, type TabId } from "../core/types";
import { initToast } from "./components/toast";
import { onVoiceError } from "./voice-recognition";
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
import { renderAuthState, wireLogin, wirePasswordToggles } from "./shell/auth-ui";
import { wireAutoClose } from "./shell/auto-close";
import { activateTab, openMoreSheet, presetActiveTab } from "./shell/nav";
import { wireSessionMenu } from "./shell/session-menu";
import { serverVersion, wireSyncListeners } from "./shell/sync";
import { applyTheme, wireThemeToggle } from "./shell/theme";
import { wireTopbar } from "./shell/topbar";

const TAB_MODULES = [inicioTab, ventaTab, entradasTab, productosTab, inventarioTab, mermasTab, fiadoTab, gastosTab, proveedoresTab, corteTab, reportesTab, ajustesTab];

const SESSION_ICON = '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><circle cx="12" cy="8.2" r="3.4"></circle><path d="M5.2 19c1.5-3.1 4-4.7 6.8-4.7s5.3 1.6 6.8 4.7"></path></svg>';

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
  if (urlTab && (ALL_TABS as readonly string[]).includes(urlTab)) presetActiveTab(urlTab as TabId);

  applyTheme(ctx);
  renderAuthState(ctx);
  wireAutoClose(ctx);

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
