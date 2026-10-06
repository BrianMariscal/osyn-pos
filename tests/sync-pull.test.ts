import { describe, expect, it, beforeEach, vi } from "vitest";
import { Store } from "../src/domain/store";
import { createInitialState, type AppState } from "../src/domain/app-state";
import { ChangeTracker } from "../src/data/change-tracker";
import { Repositories } from "../src/data/repositories";
import { SyncEngine } from "../src/data/sync-engine";
import { SettingsService } from "../src/domain/settings-service";
import type { AuthService } from "../src/domain/auth-service";
import type { SupabaseClient } from "../src/data/supabase-client";

/**
 * Lectura incremental por synced_at. Simula PostgREST con:
 * - trigger que pone synced_at (reloj del servidor) en cada upsert
 * - filtros synced_at=gte / updated_at=gte, order, limit/offset, max-rows 1000
 * - modo "sin migrar": filtrar u ordenar por synced_at responde 400
 */

type Row = Record<string, unknown>;

function makeServer({ migrated = true, reject = (_row: Row): boolean => false } = {}) {
  const tables = new Map<string, Map<string, Row>>();
  let clock = Date.parse("2026-10-03T12:00:00.000Z");
  const table = (name: string): Map<string, Row> => {
    let t = tables.get(name);
    if (!t) {
      t = new Map();
      tables.set(name, t);
    }
    return t;
  };
  const response = (body: unknown, status: number): Response =>
    ({ ok: status < 400, status, json: async () => body, text: async () => JSON.stringify(body) }) as Response;

  return {
    insertRaw(name: string, row: Row): void {
      table(name).set(String(row.id), row);
    },
    async rest(path: string, _token: string, init: RequestInit = {}): Promise<Response> {
      const [tableName = "", query = ""] = path.split("?");
      const params = new URLSearchParams(query);
      const store = table(tableName);
      if ((init.method ?? "GET").toUpperCase() === "POST") {
        const body = JSON.parse(String(init.body ?? "[]")) as Row[];
        // Como Postgres: una fila que viola una restricción tumba todo el lote.
        if (body.some(reject)) {
          return response({ code: "23514", message: "violates check constraint" }, 400);
        }
        for (const row of body) {
          const id = String(row.id);
          const next: Row = { ...store.get(id), ...row };
          if (migrated) next.synced_at = new Date((clock += 5)).toISOString();
          store.set(id, next);
        }
        return response([], 201);
      }
      const usesSyncedAt = params.has("synced_at") || (params.get("order") ?? "").includes("synced_at");
      if (usesSyncedAt && !migrated) {
        return response({ code: "42703", message: `column ${tableName}.synced_at does not exist` }, 400);
      }
      let rows = [...store.values()];
      for (const column of ["synced_at", "updated_at"]) {
        const filter = params.get(column);
        if (filter?.startsWith("gte.")) {
          const since = Date.parse(filter.slice(4));
          rows = rows.filter((row) => Date.parse(String(row[column] ?? "")) >= since);
        }
      }
      if ((params.get("order") ?? "").startsWith("synced_at")) {
        rows.sort((a, b) =>
          String(a.synced_at).localeCompare(String(b.synced_at)) || String(a.id).localeCompare(String(b.id))
        );
      }
      const offset = Number(params.get("offset") ?? 0);
      const limit = Math.min(Number(params.get("limit") ?? 1000), 1000);
      return response(rows.slice(offset, offset + limit), 200);
    },
    async rpc(): Promise<unknown> {
      return {};
    }
  };
}

type Server = ReturnType<typeof makeServer>;

function makeDevice(server: Server, role: "dueno" | "empleado" = "dueno") {
  const store = new Store<AppState>(createInitialState());
  const tracker = new ChangeTracker();
  const repos = new Repositories(store, tracker);
  const auth = {
    session: { access_token: "t", refresh_token: "r", expires_at: Math.floor(Date.now() / 1000) + 3600, user: { id: "u", email: "a@b.c" }, role, name: "d", branch_id: null },
    isAdmin: () => role === "dueno",
    isOwner: () => role === "dueno",
    refreshIfNeeded: async () => undefined
  } as unknown as AuthService;
  const client = {
    configured: true,
    rest: (path: string, token: string, init?: RequestInit) => server.rest(path, token, init ?? {}),
    rpc: () => server.rpc()
  } as unknown as SupabaseClient;
  return { store, tracker, repos, settings: new SettingsService(store, tracker), sync: new SyncEngine(store, client, auth, tracker, repos) };
}

function expense(id: string, updatedAt: string): Row {
  return { id, branch_id: "b1", concept: id, amount: 10, category: "Otros", created_at: updatedAt, updated_at: updatedAt, deleted: false };
}

beforeEach(() => {
  vi.stubGlobal("navigator", { onLine: true });
  return () => vi.unstubAllGlobals();
});

describe("pull incremental por synced_at", () => {
  it("recibe una fila subida después de la última lectura aunque su updated_at sea anterior", async () => {
    const server = makeServer();
    const a = makeDevice(server);
    const b = makeDevice(server);
    await b.sync.syncNow();

    // A editó hace rato (sin internet, o antes de que corriera su push)
    a.repos.expenses.upsert(expense("e1", "2020-01-01T00:00:00.000Z") as never);
    await b.sync.syncNow(); // B lee antes de que A suba
    await a.sync.syncNow(); // A sube
    await b.sync.syncNow();

    expect(b.store.getState().expenses.map((row) => row.id)).toEqual(["e1"]);
    expect(b.store.getState().sync.syncCursors.expenses).toBeTruthy();
    expect(b.store.getState().expenses[0]).not.toHaveProperty("synced_at");
  });

  it("pagina más de 1000 filas con el mismo synced_at (filas migradas)", async () => {
    const server = makeServer();
    for (let i = 0; i < 2500; i += 1) {
      server.insertRaw("expenses", { ...expense(`e${String(i).padStart(4, "0")}`, "2026-01-01T00:00:00.000Z"), synced_at: "2026-10-01T00:00:00.000Z" });
    }
    const b = makeDevice(server);
    await b.sync.syncNow();
    expect(b.store.getState().expenses).toHaveLength(2500);
  });

  it("sin la migración usa updated_at como antes", async () => {
    const server = makeServer({ migrated: false });
    const a = makeDevice(server);
    const b = makeDevice(server);
    a.repos.expenses.upsert(expense("e1", new Date().toISOString()) as never);
    const push = await a.sync.syncNow();
    const pull = await b.sync.syncNow();

    expect(push.ok).toBe(true);
    expect(pull.ok).toBe(true);
    expect(b.store.getState().expenses.map((row) => row.id)).toEqual(["e1"]);
    expect(b.store.getState().sync.syncCursors.expenses).toBeUndefined();
  });

  it("el logo del dueño llega a otro dispositivo y se mantiene en syncs siguientes", async () => {
    const server = makeServer();
    const owner = makeDevice(server);
    const employee = makeDevice(server, "empleado");
    const logo = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";

    owner.settings.save({ logo });
    expect((await owner.sync.syncNow()).ok).toBe(true);
    await employee.sync.syncNow();
    await employee.sync.syncNow();
    await owner.sync.syncNow();

    expect(employee.store.getState().settings.logo).toBe(logo);
    expect(owner.store.getState().settings.logo).toBe(logo);
  });
});

describe("push con filas rechazadas", () => {
  it("una fila inválida no impide subir las demás y queda pendiente", async () => {
    const server = makeServer({ reject: (row) => row.id === "malo" });
    const a = makeDevice(server);
    const b = makeDevice(server);
    const now = new Date().toISOString();
    a.repos.expenses.upsert(expense("e1", now) as never);
    a.repos.expenses.upsert(expense("malo", now) as never);
    a.repos.expenses.upsert(expense("e2", now) as never);

    const result = await a.sync.syncNow();
    expect(result.ok).toBe(false);
    expect(a.store.getState().sync.error).toMatch(/1 cambio\(s\) de expenses rechazado/);
    expect(a.tracker.takeIds("expenses")).toEqual(["malo"]);

    await b.sync.syncNow();
    expect(b.store.getState().expenses.map((row) => row.id).sort()).toEqual(["e1", "e2"]);
  });
});
