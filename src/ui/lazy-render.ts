/**
 * Render diferido para pestañas pesadas (Inicio, Reportes): si la pestaña no
 * está a la vista solo se marca como pendiente y se dibuja al abrirla; si está
 * a la vista, varios cambios seguidos (sync, ventas) se juntan en un cuadro.
 */
export function lazyRender(panel: HTMLElement, render: () => void): () => void {
  let dirty = true;
  let frame = 0;
  const visible = (): boolean => panel.classList.contains("active") && !document.hidden;
  const run = (): void => {
    frame = 0;
    if (!visible()) {
      dirty = true;
      return;
    }
    dirty = false;
    render();
  };
  const flush = (): void => {
    if (dirty && visible()) run();
  };
  document.addEventListener("pos-tab-active", flush);
  document.addEventListener("visibilitychange", flush);
  return () => {
    dirty = true;
    if (!visible() || frame) return;
    frame = requestAnimationFrame(run);
  };
}
