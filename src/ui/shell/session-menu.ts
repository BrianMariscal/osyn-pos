import { html, setHtml } from "../../core/html";
import { ROLE_LABELS } from "../../core/types";
import { openAssistantChat } from "../assistant-chat";
import { openModal } from "../components/modal";
import { openVoiceSettings } from "../voice-settings";
import { isVoiceEnabled, setVoiceEnabled } from "../voice-recognition";
import type { AppContext } from "../context";
import { checkForUpdate, friendlySyncError, syncStatus } from "./sync";
import { setThemeChoice, THEME_OPTIONS, themeChoice, type ThemeChoice } from "./theme";

export function wireSessionMenu(ctx: AppContext): void {
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
