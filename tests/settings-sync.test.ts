import { describe, expect, it, beforeEach, vi } from "vitest";
import { Store } from "../src/domain/store";
import { createInitialState, type AppState } from "../src/domain/app-state";
import { ChangeTracker } from "../src/data/change-tracker";
import { Repositories } from "../src/data/repositories";
import { SyncEngine } from "../src/data/sync-engine";
import { SettingsService } from "../src/domain/settings-service";
import { SETTINGS_ROW_ID, type Role } from "../src/core/types";
import type { AuthService } from "../src/domain/auth-service";
import type { SupabaseClient } from "../src/data/supabase-client";

/**
 * Reproducción del bug: el WhatsApp que configura el dueño debe llegar igual
 * al empleado y al administrador. Simula Supabase con semántica fiel:
 * - pull incremental con filtro updated_at=gt.{since}
 * - upsert con on_conflict=id (merge-duplicates)
 * - RPC pos_settings() devuelve el jsonb CRUDO (como PostgREST real)
 */

type Row = Record<string, unknown>;

function makeServer() {
  const tables = new Map<string, Map<string, Row>>();
  const table = (name: string): Map<string, Row> => {
    let t = tables.get(name);
    if (!t) {
      t = new Map();
      tables.set(name, t);
    }
    return t;
  };
  const jsonResponse = (rows: unknown, status: number): Response =>
    ({ ok: status < 400, status, json: async () => rows, text: async () => "" }) as Response;
  // Emula una base donde RLS oculta __pos_settings__ en el SELECT de products
  // para no-dueños (instalaciones viejas): el RPC security-definer sí la ve.
  let hideSettingsRow = false;

  return {
    rows(name: string): Row[] {
      return [...table(name).values()];
    },
    setHideSettingsRow(value: boolean): void {
      hideSettingsRow = value;
    },
    async rest(path: string, _token: string, init: RequestInit = {}): Promise<Response> {
      const [tableName = "", query = ""] = path.split("?");
      const params = new URLSearchParams(query);
      const store = table(tableName);
      if ((init.method ?? "GET").toUpperCase() === "POST") {
        const body = JSON.parse(String(init.body ?? "[]")) as Row[];
        for (const row of body) {
          const id = String(row.id);
          store.set(id, { ...store.get(id), ...row });
        }
        return jsonResponse([], 201);
      }
      let rows = [...store.values()];
      const updatedAt = params.get("updated_at");
      if (updatedAt?.startsWith("gte.")) {
        const since = updatedAt.slice(4);
        rows = rows.filter((row) => String(row.updated_at ?? "") >= since);
      } else if (updatedAt?.startsWith("gt.")) {
        const since = updatedAt.slice(3);
        rows = rows.filter((row) => String(row.updated_at ?? "") > since);
      }
      if (hideSettingsRow) rows = rows.filter((row) => row.id !== SETTINGS_ROW_ID);
      return jsonResponse(rows, 200);
    },
    // PostgREST devuelve el jsonb de la función TAL CUAL (sin envoltorio).
    // Al ser security definer, no le aplica el RLS del SELECT.
    async rpc(fn: string, _token: string): Promise<unknown> {
      if (fn !== "pos_settings") throw new Error(`fn desconocida ${fn}`);
      const row = table("products").get(SETTINGS_ROW_ID);
      const data = row?.data as { settings?: unknown } | undefined;
      return data?.settings ?? {};
    }
  };
}

type Server = ReturnType<typeof makeServer>;

function fakeAuth(role: Role): AuthService {
  return {
    session: {
      access_token: `token-${role}`,
      refresh_token: `refresh-${role}`,
      expires_at: Math.floor(Date.now() / 1000) + 3600,
      user: { id: `user-${role}`, email: `${role}@tienda.com` },
      role,
      name: role,
      branch_id: null
    },
    isAdmin: () => role === "dueno" || role === "admin",
    isOwner: () => role === "dueno",
    refreshIfNeeded: async () => undefined
  } as unknown as AuthService;
}

function fakeClient(server: Server): SupabaseClient {
  return {
    configured: true,
    rest: (path: string, token: string, init?: RequestInit) => server.rest(path, token, init ?? {}),
    rpc: (fn: string, token: string) => server.rpc(fn, token)
  } as unknown as SupabaseClient;
}

interface Device {
  store: Store<AppState>;
  tracker: ChangeTracker;
  repos: Repositories;
  settings: SettingsService;
  sync: SyncEngine;
}

function makeDevice(role: Role, server: Server): Device {
  const store = new Store<AppState>(createInitialState());
  const tracker = new ChangeTracker();
  const repos = new Repositories(store, tracker);
  const settings = new SettingsService(store, tracker);
  const auth = fakeAuth(role);
  const sync = new SyncEngine(store, fakeClient(server), auth, tracker, repos);
  return { store, tracker, repos, settings, sync };
}

beforeEach(() => {
  vi.stubGlobal("navigator", { onLine: true });
  return () => vi.unstubAllGlobals();
});

describe("sync de ajustes (WhatsApp del dueño → empleado/admin)", () => {
  it("el dueño sube la fila de ajustes y el empleado la recibe igual", async () => {
    const server = makeServer();
    const owner = makeDevice("dueno", server);
    const employee = makeDevice("empleado", server);

    owner.settings.save({ whatsappNumber: "521550000001", whatsapp2: "521550000002", whatsapp3: "" });
    const push = await owner.sync.syncNow();
    expect(push.ok).toBe(true);

    const cloudRow = server.rows("products").find((row) => row.id === SETTINGS_ROW_ID);
    expect((cloudRow?.data as { settings?: { whatsappNumber?: string } })?.settings?.whatsappNumber).toBe("521550000001");

    const pull = await employee.sync.syncNow();
    expect(pull.ok).toBe(true);
    const settings = employee.store.getState().settings;
    expect(settings.whatsappNumber).toBe("521550000001");
    expect(settings.whatsapp2).toBe("521550000002");
    // La fila de ajustes no debe contaminar el catálogo
    expect(employee.store.getState().products.some((p) => p.id === SETTINGS_ROW_ID)).toBe(false);
  });

  it("un cambio posterior del dueño se propaga por pull incremental", async () => {
    const server = makeServer();
    const owner = makeDevice("dueno", server);
    const admin = makeDevice("admin", server);

    owner.settings.save({ whatsappNumber: "521550000001" });
    expect((await owner.sync.syncNow()).ok).toBe(true);
    expect((await admin.sync.syncNow()).ok).toBe(true);
    expect(admin.store.getState().settings.whatsappNumber).toBe("521550000001");

    owner.settings.save({ whatsappNumber: "521559999999" });
    expect((await owner.sync.syncNow()).ok).toBe(true);
    expect((await admin.sync.syncNow()).ok).toBe(true);
    expect(admin.store.getState().settings.whatsappNumber).toBe("521559999999");
  });

  it("un ajuste sin subir no se pierde si la nube trae la misma marca de tiempo", async () => {
    vi.useFakeTimers({ now: new Date("2026-10-03T12:00:00.000Z"), toFake: ["Date"] });
    try {
      const server = makeServer();
      const owner = makeDevice("dueno", server);
      owner.settings.save({ whatsappNumber: "521550000001" });
      expect((await owner.sync.syncNow()).ok).toBe(true);
      // Mismo milisegundo: la fila de la nube empata con el cambio local pendiente
      owner.settings.save({ whatsappNumber: "521559999999" });
      expect((await owner.sync.syncNow()).ok).toBe(true);
      expect(owner.store.getState().settings.whatsappNumber).toBe("521559999999");
    } finally {
      vi.useRealTimers();
    }
  });

  it("el RPC pos_settings (jsonb crudo) sirve como respaldo si RLS oculta la fila en products", async () => {
    const server = makeServer();
    const owner = makeDevice("dueno", server);
    const employee = makeDevice("empleado", server);

    owner.settings.save({ whatsappNumber: "521550000001" });
    expect((await owner.sync.syncNow()).ok).toBe(true);
    // La fila ya no viaja en el pull de products, pero el RPC sí la conoce
    server.setHideSettingsRow(true);

    const pull = await employee.sync.syncNow();
    expect(pull.ok).toBe(true);
    expect(employee.store.getState().settings.whatsappNumber).toBe("521550000001");
  });
});
