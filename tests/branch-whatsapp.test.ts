import { describe, expect, it, beforeEach } from "vitest";
import { Store } from "../src/domain/store";
import { createInitialState, type AppState } from "../src/domain/app-state";
import { ChangeTracker } from "../src/data/change-tracker";
import { Repositories } from "../src/data/repositories";
import { BranchService } from "../src/domain/branch-service";
import { SettingsService } from "../src/domain/settings-service";
import { DEFAULT_BRANCH_ID, SETTINGS_ROW_ID, type Role } from "../src/core/types";
import type { AuthService } from "../src/domain/auth-service";

function fakeAuth(role: Role): AuthService {
  return {
    isAdmin: () => role !== "empleado",
    isOwner: () => role === "dueno",
    assignedBranchId: () => (role === "empleado" ? DEFAULT_BRANCH_ID : null)
  } as unknown as AuthService;
}

/**
 * El WhatsApp del corte vive SOLO en la sucursal (antes se duplicaba en los
 * ajustes de la tienda): estas pruebas fijan la migración y el corte del
 * respaldo viejo.
 */
describe("WhatsApp del corte por sucursal", () => {
  let store: Store<AppState>;
  let repos: Repositories;
  let tracker: ChangeTracker;
  let settings: SettingsService;

  beforeEach(() => {
    store = new Store<AppState>(createInitialState());
    tracker = new ChangeTracker();
    repos = new Repositories(store, tracker);
    settings = new SettingsService(store, tracker);
  });

  const setStoreNumbers = (): void => {
    store.update((state) => {
      state.settings = {
        ...state.settings,
        whatsappNumber: "5215511111111",
        whatsapp2: "5215522222222",
        whatsapp3: "5215533333333"
      };
    });
  };

  it("pasa los números de la tienda a la sucursal sin números y vacía los ajustes", () => {
    setStoreNumbers();
    const branches = new BranchService(store, fakeAuth("dueno"), repos, settings);
    branches.ensureSeeded();
    const branch = branches.byId(DEFAULT_BRANCH_ID);
    expect(branch?.whatsapp1).toBe("5215511111111");
    expect(branch?.whatsapp2).toBe("5215522222222");
    const after = store.getState().settings;
    expect(after.whatsappNumber).toBe("");
    expect(after.whatsapp2).toBe("");
    expect(after.whatsapp3).toBe("");
    // El vaciado de los ajustes queda pendiente de subir (una sola fuente).
    expect(tracker.takeIds("products") ?? []).toContain(SETTINGS_ROW_ID);
  });

  it("no pisa los números que la sucursal ya tenía, pero sí vacía los ajustes", () => {
    setStoreNumbers();
    const branches = new BranchService(store, fakeAuth("dueno"), repos, settings);
    const created = branches.create("Centro");
    branches.update(created.id, { whatsapp1: "5215599999999" });
    branches.ensureSeeded();
    const branch = branches.byId(created.id);
    expect(branch?.whatsapp1).toBe("5215599999999");
    expect(branch?.whatsapp2).toBe("");
    expect(store.getState().settings.whatsappNumber).toBe("");
  });

  it("un administrador no siembra ni migra nada", () => {
    setStoreNumbers();
    new BranchService(store, fakeAuth("admin"), repos, settings).ensureSeeded();
    expect(repos.branches.list()).toHaveLength(0);
    expect(store.getState().settings.whatsappNumber).toBe("5215511111111");
  });

  it("shiftWhatsappNumbers usa solo los de la sucursal (sin respaldo de tienda)", () => {
    setStoreNumbers();
    const branches = new BranchService(store, fakeAuth("dueno"), repos, settings);
    const created = branches.create("Centro");
    expect(branches.shiftWhatsappNumbers(created.id)).toEqual([]);
    branches.update(created.id, { whatsapp1: " 5215500000000 " });
    expect(branches.shiftWhatsappNumbers(created.id)).toEqual(["5215500000000"]);
  });
});
