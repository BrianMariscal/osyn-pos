import { get, set } from "idb-keyval";
import type { AuthSession, SyncTableKey } from "../core/types";
import type { AppState } from "../domain/app-state";
import type { Store } from "../domain/store";

/**
 * Persistencia offline: TODO el estado se guarda en IndexedDB tras cada cambio
 * (debounce 300 ms). El respaldo local nunca se borra al sincronizar, así las
 * ventas offline no se pierden aunque falle la conexión.
 */
const SNAPSHOT_KEY = "abarrotes-pos-state-v3";
const TRACKER_KEY = "abarrotes-pos-tracker-v1";

function scopedKey(prefix: string, scope: string): string {
  const safeScope = scope.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 120) || "guest";
  return `${prefix}:${safeScope}`;
}

export async function loadSnapshot(scope = "guest"): Promise<unknown> {
  try {
    return await get(scopedKey(SNAPSHOT_KEY, scope));
  } catch {
    return null;
  }
}

export function attachPersistence(store: Store<AppState>, scope = "guest"): void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  store.subscribe(() => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      void set(scopedKey(SNAPSHOT_KEY, scope), store.getState()).catch(() => undefined);
    }, 300);
  });
}

export interface TrackerSnapshot {
  dirty: Partial<Record<SyncTableKey, string[]>>;
  deltas: Record<string, Record<string, number>>;
}

export async function loadTracker(scope = "guest"): Promise<TrackerSnapshot | null> {
  try {
    return (await get(scopedKey(TRACKER_KEY, scope))) as TrackerSnapshot | null;
  } catch {
    return null;
  }
}

export function attachTrackerPersistence(
  tracker: { snapshot: () => TrackerSnapshot; addListener: (callback: () => void) => () => void },
  scope = "guest"
): void {
  tracker.addListener(() => {
    try {
      void set(scopedKey(TRACKER_KEY, scope), tracker.snapshot()).catch(() => undefined);
    } catch {
      /* IndexedDB no disponible (pruebas o navegador restringido) */
    }
  });
}

const AUTH_KEY = "abarrotes-pos-auth-v2";

export function loadAuthSession(): AuthSession | null {
  try {
    const raw = localStorage.getItem(AUTH_KEY);
    return raw ? (JSON.parse(raw) as AuthSession) : null;
  } catch {
    return null;
  }
}

export function saveAuthSession(session: AuthSession | null): void {
  try {
    if (session) localStorage.setItem(AUTH_KEY, JSON.stringify(session));
    else localStorage.removeItem(AUTH_KEY);
  } catch {
    /* almacenamiento no disponible */
  }
}
