import type { SyncState } from "../core/types";

/** Tiempo sin sincronizar, con cambios pendientes, a partir del cual se avisa. */
export const STALE_SYNC_MS = 60 * 60_000;

/**
 * Aviso para Inicio cuando hay ventas o cambios que no llegan a la nube:
 * la nube rechazó alguno, o lleva más de una hora sin subir. null = todo bien.
 */
export function syncAlert(sync: SyncState, now = Date.now()): string | null {
  if (sync.pending <= 0) return null;
  const count = `${sync.pending} cambio${sync.pending === 1 ? "" : "s"}`;
  if (sync.error && /rechazado/i.test(sync.error)) {
    return `La nube rechazó ${count === "1 cambio" ? "un cambio" : "algunos cambios"} de este equipo. Avisa al dueño para revisarlo.`;
  }
  const last = sync.lastSyncAt ? Date.parse(sync.lastSyncAt) : NaN;
  const minutes = Number.isFinite(last) ? Math.floor((now - last) / 60_000) : null;
  // Equipo que aún no termina su primera sincronización (recién conectado):
  // solo se avisa si ya falló, para no alarmar en el primer segundo.
  if (minutes === null && !sync.error) return null;
  if (minutes !== null && minutes * 60_000 < STALE_SYNC_MS) return null;
  const since = minutes === null ? "" : minutes < 120 ? ` desde hace ${minutes} min` : ` desde hace ${Math.floor(minutes / 60)} h`;
  return `Hay ${count} sin subir a la nube${since}. Revisa el internet de este equipo.`;
}
