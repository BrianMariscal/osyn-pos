import { nowISO } from "../core/dates";
import { uid } from "../core/id";
import { DEFAULT_BRANCH_ID, DEFAULT_BRANCH_NAME, type Branch } from "../core/types";
import { VIEW_ALL, type AppState } from "./app-state";
import type { AuthService } from "./auth-service";
import type { Repositories } from "../data/repositories";
import type { SettingsService } from "./settings-service";
import type { Store } from "./store";

/**
 * Contexto de sucursal:
 * - Empleado, o administrador con sucursal asignada: sucursal fija desde su
 *   perfil (operationalId), sin selector ni vista consolidada.
 * - Admin: sucursal operativa seleccionable (donde vende/corta caja) y un
 *   alcance de vista para dashboard/reportes (sucursal o "all" = consolidado).
 *
 * Por defecto la tienda arranca con UNA sola sucursal; el dueño crea más
 * desde Ajustes > Sucursales. Solo con varias hay selector y vista consolidada.
 */
export class BranchService {
  constructor(
    private store: Store<AppState>,
    private auth: AuthService,
    private repos: Repositories,
    private settings?: SettingsService
  ) {}

  /** Dueño sin sucursales en la nube: siembra la sucursal inicial. */
  ensureSeeded(): void {
    if (!this.auth.isOwner()) return;
    if (!this.repos.branches.list().length) {
      const ts = nowISO();
      this.repos.branches.upsert({
        id: DEFAULT_BRANCH_ID,
        name: DEFAULT_BRANCH_NAME,
        address: "",
        active: true,
        created_at: ts,
        updated_at: ts
      });
    }
    this.migrateStoreNumbers();
  }

  /**
   * Una sola vez: los WhatsApp que vivían en los ajustes de la tienda se pasan
   * a cada sucursal sin números y los ajustes se vacían. Así la sucursal queda
   * como el único lugar donde se configuran (y ahí los edita también el admin).
   */
  private migrateStoreNumbers(): void {
    const stored = [
      this.store.getState().settings.whatsappNumber,
      this.store.getState().settings.whatsapp2,
      this.store.getState().settings.whatsapp3
    ]
      .map((number) => (number || "").trim())
      .filter(Boolean);
    if (!stored.length) return;
    this.list()
      .filter((branch) => !(branch.whatsapp1 || "").trim() && !(branch.whatsapp2 || "").trim())
      .forEach((branch) => this.update(branch.id, { whatsapp1: stored[0] ?? "", whatsapp2: stored[1] ?? "" }));
    this.settings?.save({ whatsappNumber: "", whatsapp2: "", whatsapp3: "" });
  }

  list(): Branch[] {
    return this.repos.branches.list().filter((branch) => branch.active !== false);
  }

  /** Con una sola sucursal no hay selector ni consolidado. */
  isMultiBranch(): boolean {
    return this.list().length > 1;
  }

  /** Puede cambiar de sucursal y ver el consolidado (dueño o admin sin sucursal asignada). */
  canSwitch(): boolean {
    return this.isMultiBranch() && !this.auth.assignedBranchId();
  }

  byId(id: string): Branch | undefined {
    return this.repos.branches.byId(id);
  }

  name(id: string): string {
    return this.byId(id)?.name || id;
  }

  /** Sucursal concreta donde ocurren las operaciones (venta, corte, gastos). */
  operationalId(): string {
    const employeeBranch = this.auth.assignedBranchId();
    if (employeeBranch) return employeeBranch;
    const state = this.store.getState();
    if (state.currentBranchId && this.byId(state.currentBranchId)?.active !== false && state.currentBranchId) {
      return state.currentBranchId;
    }
    return this.list()[0]?.id ?? DEFAULT_BRANCH_ID;
  }

  /** Alcance de dashboard/reportes: sucursal o "all" (consolidado, solo con varias). */
  viewScope(): string {
    const employeeBranch = this.auth.assignedBranchId();
    if (employeeBranch) return employeeBranch;
    const branches = this.list();
    if (branches.length <= 1) return branches[0]?.id ?? DEFAULT_BRANCH_ID;
    return this.store.getState().viewBranchId || VIEW_ALL;
  }

  setOperational(id: string): void {
    this.store.update((state) => {
      state.currentBranchId = id;
    });
  }

  setViewScope(scope: string): void {
    this.store.update((state) => {
      state.viewBranchId = scope;
    });
  }

  /** Dueño: crea una sucursal nueva. */
  create(name: string): Branch {
    const ts = nowISO();
    const branch: Branch = { id: `sucursal-${uid().slice(0, 8)}`, name, address: "", active: true, created_at: ts, updated_at: ts };
    this.repos.branches.upsert(branch);
    return branch;
  }

  /** Admin: renombra una sucursal. */
  rename(id: string, name: string): Branch | undefined {
    return this.update(id, { name });
  }

  /** Edita nombre, WhatsApp del corte y cierre automático (el admin solo su sucursal). */
  update(id: string, patch: Partial<Pick<Branch, "name" | "whatsapp1" | "whatsapp2" | "auto_close">>): Branch | undefined {
    const branch = this.byId(id);
    if (!branch || branch.deleted) return undefined;
    const nextName = patch.name !== undefined ? patch.name.trim() || branch.name : branch.name;
    const next: Branch = {
      ...branch,
      ...patch,
      name: nextName,
      whatsapp1: (patch.whatsapp1 ?? branch.whatsapp1 ?? "").trim(),
      whatsapp2: (patch.whatsapp2 ?? branch.whatsapp2 ?? "").trim(),
      updated_at: nowISO()
    };
    this.repos.branches.upsert(next);
    return next;
  }

  /** Números de WhatsApp del corte configurados en la sucursal (máximo dos). */
  shiftWhatsappNumbers(branchId: string): string[] {
    const branch = this.byId(branchId);
    return [branch?.whatsapp1, branch?.whatsapp2].map((number) => (number || "").trim()).filter(Boolean);
  }
}
