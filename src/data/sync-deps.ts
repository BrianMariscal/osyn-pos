import type { AppState } from "../domain/app-state";
import type { AuthService } from "../domain/auth-service";
import type { Store } from "../domain/store";
import type { ChangeTracker } from "./change-tracker";
import type { Repositories } from "./repositories";
import type { SupabaseClient } from "./supabase-client";

/** Dependencias que comparten el pull y el push de la sincronización. */
export interface SyncDeps {
  store: Store<AppState>;
  client: SupabaseClient;
  auth: AuthService;
  tracker: ChangeTracker;
  repos: Repositories;
}
