import { describe, expect, it, beforeEach } from "vitest";
import { Store } from "../src/domain/store";
import { createInitialState, type AppState } from "../src/domain/app-state";
import { ChangeTracker } from "../src/data/change-tracker";
import { Repositories } from "../src/data/repositories";
import { BranchService } from "../src/domain/branch-service";
import { DEFAULT_BRANCH_ID, type Role } from "../src/core/types";
import { VIEW_ALL } from "../src/domain/app-state";
import type { AuthService } from "../src/domain/auth-service";

function fakeAuth(role: Role): AuthService {
  return {
    isAdmin: () => role !== "empleado",
    isOwner: () => role === "dueno",
    employeeBranchId: () => (role === "empleado" ? DEFAULT_BRANCH_ID : null)
  } as unknown as AuthService;
}

describe("branch-service (una sucursal por defecto)", () => {
  let store: Store<AppState>;
  let repos: Repositories;

  beforeEach(() => {
    store = new Store<AppState>(createInitialState());
    repos = new Repositories(store, new ChangeTracker());
  });

  it("siembra una sola sucursal cuando el dueño entra sin ninguna", () => {
    const branches = new BranchService(store, fakeAuth("dueno"), repos);
    branches.ensureSeeded();
    const list = branches.list();
    expect(list).toHaveLength(1);
    expect(list[0]?.id).toBe(DEFAULT_BRANCH_ID);
  });

  it("un administrador o vendedor no siembra sucursales", () => {
    for (const role of ["admin", "empleado"] as const) {
      const store2 = new Store<AppState>(createInitialState());
      const repos2 = new Repositories(store2, new ChangeTracker());
      new BranchService(store2, fakeAuth(role), repos2).ensureSeeded();
      expect(repos2.branches.list()).toHaveLength(0);
    }
  });

  it("con una sucursal no hay consolidado y el alcance es esa sucursal", () => {
    const branches = new BranchService(store, fakeAuth("dueno"), repos);
    branches.ensureSeeded();
    expect(branches.isMultiBranch()).toBe(false);
    expect(branches.viewScope()).toBe(DEFAULT_BRANCH_ID);
    expect(branches.operationalId()).toBe(DEFAULT_BRANCH_ID);
  });

  it("al crear una segunda sucursal activa el selector y el consolidado", () => {
    const branches = new BranchService(store, fakeAuth("dueno"), repos);
    branches.ensureSeeded();
    branches.create("Sucursal Centro");
    expect(branches.isMultiBranch()).toBe(true);
    expect(branches.list()).toHaveLength(2);
    expect(branches.viewScope()).toBe(VIEW_ALL);
  });

  it("no siembra nada si ya existen sucursales en la nube", () => {
    const branches = new BranchService(store, fakeAuth("dueno"), repos);
    branches.create("Sucursal A");
    branches.ensureSeeded();
    expect(branches.list()).toHaveLength(1);
    expect(branches.list()[0]?.name).toBe("Sucursal A");
  });
});
