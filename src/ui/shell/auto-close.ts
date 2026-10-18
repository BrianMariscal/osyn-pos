/**
 * Cierre automático de medianoche: revisa cada minuto (y al volver a la app)
 * si el día de ayer quedó sin corte; si hubo movimientos, lo cierra solo con
 * el efectivo esperado. Las sucursales con auto_close = false no se tocan.
 */
import { fmtMoneyPesos } from "../../core/money";
import type { AppContext } from "../context";

export function wireAutoClose(ctx: AppContext): void {
  let running = false;
  const check = (): void => {
    // Solo gerencia: en los equipos de vendedor no hay pantalla de corte.
    if (running || !ctx.auth.isAuthenticated || !ctx.auth.isAdmin()) return;
    running = true;
    try {
      const shift = ctx.shifts.autoCloseIfNeeded(ctx.branches.operationalId());
      if (shift) ctx.toast(`Corte automático de medianoche: ${fmtMoneyPesos(shift.summary.ventas)} en ventas`);
    } catch {
      // Nunca tirar la app por el cierre automático.
    } finally {
      running = false;
    }
  };
  window.setInterval(check, 60_000);
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) check();
  });
  ctx.auth.onSessionChange(() => check());
  check();
}
