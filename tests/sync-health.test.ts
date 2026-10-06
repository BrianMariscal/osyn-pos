import { describe, expect, it } from "vitest";
import { syncAlert } from "../src/domain/sync-health";
import type { SyncState } from "../src/core/types";

const NOW = Date.parse("2026-10-06T18:00:00.000Z");

function sync(partial: Partial<SyncState>): SyncState {
  return { lastPulledAt: {}, syncCursors: {}, lastSyncAt: null, error: null, pending: 0, syncing: false, ...partial };
}

describe("aviso de sincronización en Inicio", () => {
  it("sin pendientes no avisa aunque haya error de red", () => {
    expect(syncAlert(sync({ error: "Failed to fetch" }), NOW)).toBeNull();
  });

  it("pendientes recientes no avisan", () => {
    expect(syncAlert(sync({ pending: 3, lastSyncAt: new Date(NOW - 10 * 60_000).toISOString() }), NOW)).toBeNull();
  });

  it("avisa si lleva más de una hora sin subir", () => {
    const message = syncAlert(sync({ pending: 3, lastSyncAt: new Date(NOW - 3 * 3600_000).toISOString() }), NOW);
    expect(message).toMatch(/3 cambios sin subir a la nube desde hace 3 h/);
  });

  it("avisa de inmediato si la nube rechazó cambios", () => {
    const message = syncAlert(sync({ pending: 1, lastSyncAt: new Date(NOW).toISOString(), error: "1 cambio(s) de sales rechazado(s) por la nube: ..." }), NOW);
    expect(message).toMatch(/rechazó un cambio/);
  });
});
