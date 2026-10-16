import { RealtimeSync } from "../../data/realtime";
import { syncTablesFor } from "../../data/sync-engine";
import type { AppContext } from "../context";

type SyncState = "ok" | "pending" | "offline" | "error" | "idle";

/** Estado de sincronización legible (punto del avatar y menú de cuenta). */
export function syncStatus(ctx: AppContext): { state: SyncState; label: string; detail: string } {
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

/** Mensajes de error de red legibles. */
export function friendlySyncError(error: string): string {
  if (/failed to fetch|networkerror|load failed|network request failed/i.test(error)) return "No hay conexión con el servidor. Se reintentará solo.";
  if (/jwt|401|token/i.test(error)) return "La sesión expiró. Cierra sesión y vuelve a entrar.";
  return error;
}

/** Versión publicada en el servidor (null sin conexión). */
export async function serverVersion(): Promise<string | null> {
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
export async function checkForUpdate(): Promise<boolean> {
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

export function wireSyncListeners(ctx: AppContext): void {
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
