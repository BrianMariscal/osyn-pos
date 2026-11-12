import { html, setHtml } from "../core/html";

const LOCK_NAME = "osyn-pos-instance";

/** Pantalla que bloquea una segunda pestaña para no duplicar ventas. */
function blockedScreen(): void {
  const screen = document.createElement("div");
  screen.className = "single-instance-screen";
  setHtml(
    screen,
    html`
      <div class="card single-instance-card">
        <h1>OSYN POS ya está abierto</h1>
        <p class="muted">
          Para evitar ventas duplicadas o datos cruzados, usa la pestaña que ya tienes abierta.
          Si esa pestaña ya no existe, recarga esta.
        </p>
        <button class="primary" type="button" data-retry>Reintentar</button>
      </div>
    `
  );
  document.body.appendChild(screen);
  screen.querySelector("[data-retry]")?.addEventListener("click", () => window.location.reload());
}

/**
 * Arranca la app solo si esta pestaña obtiene el candado de instancia única.
 * Dos pestañas comparten IndexedDB pero no el estado en memoria: podrían
 * cobrar el mismo carrito o pisarse los cambios. El candado se mantiene
 * mientras la pestaña siga abierta.
 */
export function bootSingleInstance(boot: () => void): void {
  const locks = navigator.locks;
  if (!locks) {
    boot();
    return;
  }
  let booted = false;
  const run = (): void => {
    if (booted) return;
    booted = true;
    boot();
  };
  void locks
    .request(LOCK_NAME, { mode: "exclusive", ifAvailable: true }, (lock) => {
      if (!lock) {
        blockedScreen();
        return undefined;
      }
      run();
      // Se conserva el candado hasta que se cierre la pestaña.
      return new Promise<void>(() => undefined);
    })
    .catch(() => run());
}
