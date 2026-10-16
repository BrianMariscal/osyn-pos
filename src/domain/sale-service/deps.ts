import type { Repositories } from "../../data/repositories";
import type { AppState } from "../app-state";
import type { BranchService } from "../branch-service";
import type { Store } from "../store";

/** Dependencias compartidas de la venta (la clase las expone tal cual). */
export interface SaleDeps {
  store: Store<AppState>;
  repos: Repositories;
  branches: BranchService;
}
