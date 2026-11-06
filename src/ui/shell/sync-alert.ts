import { html, setHtml } from "../../core/html";
import { syncAlert } from "../../domain/sync-health";
import type { AppContext } from "../context";

/**
 * Aviso global de sincronización: se muestra en cualquier pestaña cuando hay
 * cambios pendientes con más de una hora sin subir o la nube rechazó filas.
 * Antes vivía solo en Inicio; en un equipo que se queda en Venta todo el día
 * el aviso no se veía.
 */
export function wireSyncAlert(ctx: AppContext): void {
  const el = document.getElementById("globalSyncAlert");
  if (!el) return;
  const render = (): void => {
    const message = syncAlert(ctx.store.getState().sync);
    el.classList.toggle("hidden", !message);
    setHtml(el, message ? html`<span>${message}</span><button class="ghost" type="button" data-sync-now>Sincronizar ahora</button>` : html``);
  };
  el.addEventListener("click", (event) => {
    if (!(event.target as HTMLElement).closest("[data-sync-now]")) return;
    void ctx.sync.syncNow().then((result) => {
      ctx.toast(result.ok ? "Sincronizado" : result.error ?? "No se pudo sincronizar");
    });
  });
  ctx.store.watch((s) => [s.sync.pending, s.sync.error, s.sync.lastSyncAt] as const, render);
  // "Desde hace X" avanza con el reloj aunque nada cambie.
  window.setInterval(render, 60_000);
  render();
}
