/**
 * Reporte de errores a Sentry. Solo se descarga el SDK si hay DSN en
 * public/config.js; sin DSN no se carga nada. No se envían correos ni datos
 * de ventas: solo el error, la versión y el id/rol/sucursal del usuario.
 */
export interface MonitoringUser {
  id: string;
  role?: string;
  branch?: string | null;
}

type SentryModule = typeof import("@sentry/browser");

let sentry: Promise<SentryModule | null> = Promise.resolve(null);

export function initMonitoring(dsn: string): void {
  if (!dsn) return;
  sentry = import("@sentry/browser")
    .then((mod) => {
      mod.init({
        dsn,
        release: typeof __APP_VERSION__ === "string" ? __APP_VERSION__ : undefined,
        environment: location.hostname === "localhost" ? "development" : "production",
        sendDefaultPii: false,
        // Errores de red esperables sin internet: no son fallas de la app.
        ignoreErrors: [/failed to fetch/i, /networkerror/i, /load failed/i, /network request failed/i]
      });
      return mod;
    })
    .catch(() => null);
}

export function setMonitoringUser(user: MonitoringUser | null): void {
  void sentry.then((mod) => {
    if (!mod) return;
    mod.setUser(user ? { id: user.id } : null);
    mod.setTag("role", user?.role ?? "none");
    mod.setTag("branch", user?.branch ?? "all");
  });
}

/** Avisos que no son excepciones pero conviene ver (p. ej. filas rechazadas al sincronizar). */
export function reportIssue(message: string, extra?: Record<string, unknown>): void {
  void sentry.then((mod) => {
    mod?.captureMessage(message, { level: "warning", extra });
  });
}
