import { html, setHtml } from "../../../core/html";
import { syncAlert } from "../../../domain/sync-health";
import { type InicioScene } from "./scene";

/** Aviso de sincronización del inicio: pendientes, errores y "hace X". */
export function createSyncAlert(scene: InicioScene): void {
  const { ctx, ui } = scene;
  const syncAlertEl = ui.syncAlertEl;
  const renderSyncAlert = (): void => {
    const message = syncAlert(ctx.store.getState().sync);
    syncAlertEl.classList.toggle("hidden", !message);
    setHtml(syncAlertEl, message ? html`<span>${message}</span><button class="ghost" type="button" data-sync-now>Sincronizar ahora</button>` : html``);
  };
  syncAlertEl.addEventListener("click", (event) => {
    if (!(event.target as HTMLElement).closest("[data-sync-now]")) return;
    void ctx.sync.syncNow().then((result) => {
      ctx.toast(result.ok ? "Sincronizado" : result.error ?? "No se pudo sincronizar");
    });
  });
  ctx.store.watch((s) => [s.sync.pending, s.sync.error, s.sync.lastSyncAt] as const, renderSyncAlert);
  // "Desde hace X" avanza con el reloj aunque nada cambie.
  window.setInterval(renderSyncAlert, 60_000);
}
