// @vitest-environment jsdom
/**
 * Ajustes › Sucursales: el dueño ve y edita todo; el administrador también
 * entra (antes la sección era solo del dueño y no podía configurar su
 * WhatsApp), pero no crea sucursales y, si tiene una asignada, solo edita la
 * suya. Los números viven solo aquí.
 */
import { describe, expect, it, beforeEach } from "vitest";
import { Store } from "../src/domain/store";
import { createInitialState, type AppState } from "../src/domain/app-state";
import { ChangeTracker } from "../src/data/change-tracker";
import { Repositories } from "../src/data/repositories";
import { BranchService } from "../src/domain/branch-service";
import { SettingsService } from "../src/domain/settings-service";
import { createBranchesSection } from "../src/ui/tabs/ajustes/branches";
import { closeAllModals } from "../src/ui/components/modal";
import { DEFAULT_BRANCH_ID, type Role } from "../src/core/types";
import type { AuthService } from "../src/domain/auth-service";
import type { AppContext } from "../src/ui/context";

function fakeAuth(role: Role, branchId: string | null = null): AuthService {
  return {
    isAdmin: () => role !== "empleado",
    isOwner: () => role === "dueno",
    assignedBranchId: () => branchId
  } as unknown as AuthService;
}

function setup(role: Role, branchId: string | null = null) {
  document.body.innerHTML = `<div id="root">
    <section id="branchesSection" hidden>
      <button id="addBranch">Agregar</button>
      <p id="branchesHint"></p>
      <div id="branchesList"></div>
    </section>
  </div>`;
  const root = document.getElementById("root") as HTMLElement;
  const store = new Store<AppState>(createInitialState());
  const tracker = new ChangeTracker();
  const repos = new Repositories(store, tracker);
  const auth = fakeAuth(role, branchId);
  const branches = new BranchService(store, auth, repos, new SettingsService(store, tracker));
  if (role === "dueno") {
    branches.ensureSeeded();
    branches.update(DEFAULT_BRANCH_ID, { whatsapp1: "5215511111111" });
  } else {
    const ts = new Date().toISOString();
    repos.branches.upsert({ id: DEFAULT_BRANCH_ID, name: "Centro", address: "", active: true, created_at: ts, updated_at: ts });
    repos.branches.upsert({ id: "norte", name: "Norte", address: "", active: true, created_at: ts, updated_at: ts });
    store.update((state) => {
      state.currentBranchId = branchId || DEFAULT_BRANCH_ID;
    });
  }
  const ctx = { store, auth, branches, toast: () => undefined } as unknown as AppContext;
  createBranchesSection(root, ctx);
  return { root, store, branches };
}

const editButtons = (): HTMLButtonElement[] =>
  [...document.querySelectorAll<HTMLButtonElement>("#branchesList [data-edit-branch]")];

const modalField = (id: string): HTMLInputElement | null => document.getElementById(id) as HTMLInputElement | null;

describe("Ajustes › Sucursales por rol", () => {
  beforeEach(() => {
    closeAllModals();
  });

  it("el dueño ve todas las sucursales, el botón Agregar y edita nombre y WhatsApp", () => {
    setup("dueno");
    const addButton = document.getElementById("addBranch") as HTMLButtonElement;
    expect(addButton.hidden).toBe(false);
    expect(editButtons()).toHaveLength(1);
    editButtons()[0]!.click();
    const name = modalField("bName");
    expect(name).not.toBeNull();
    expect((modalField("bWa1") as HTMLInputElement).value).toBe("5215511111111");
  });

  it("el administrador con sucursal ve la sección, sin Agregar, y solo edita la suya", () => {
    const { branches } = setup("admin", DEFAULT_BRANCH_ID);
    const section = document.getElementById("branchesSection") as HTMLElement;
    expect(section.hidden).toBe(false);
    expect((document.getElementById("addBranch") as HTMLButtonElement).hidden).toBe(true);
    // Hay dos sucursales visibles pero solo una con botón Editar (la asignada).
    expect(document.querySelectorAll("#branchesList .list-item")).toHaveLength(2);
    expect(editButtons()).toHaveLength(1);
    expect(editButtons()[0]!.dataset.editBranch).toBe(DEFAULT_BRANCH_ID);

    editButtons()[0]!.click();
    // El modal del admin configura WhatsApp y cierre, no el nombre.
    expect(modalField("bName")).toBeNull();
    expect(modalField("bWa2")).not.toBeNull();
    (modalField("bWa1") as HTMLInputElement).value = "5215599999999";
    const save = [...document.querySelectorAll<HTMLButtonElement>("[data-modal-action]")].find(
      (button) => button.dataset.modalAction === "Guardar"
    )!;
    save.click();
    expect(branches.byId(DEFAULT_BRANCH_ID)?.whatsapp1).toBe("5215599999999");
    expect(branches.byId(DEFAULT_BRANCH_ID)?.name).toBe("Centro");
  });

  it("el administrador sin sucursal edita cualquiera y el vendedor no ve nada", () => {
    setup("admin", null);
    expect(editButtons()).toHaveLength(2);

    closeAllModals();
    setup("empleado", null);
    expect((document.getElementById("branchesSection") as HTMLElement).hidden).toBe(true);
  });
});
