import type { PosConfig } from "../core/config";
import type { AppState } from "../domain/app-state";
import type { AuthService } from "../domain/auth-service";
import type { BranchService } from "../domain/branch-service";
import type { CreditService } from "../domain/credit-service";
import type { InventoryService } from "../domain/inventory-service";
import type { ReportService } from "../domain/report-service";
import type { SaleService } from "../domain/sale-service";
import type { SettingsService } from "../domain/settings-service";
import type { ShiftService } from "../domain/shift-service";
import type { UserAdminService } from "../domain/user-admin-service";
import type { Store } from "../domain/store";
import type { ChangeTracker } from "../data/change-tracker";
import type { Repositories } from "../data/repositories";
import type { SupabaseClient } from "../data/supabase-client";
import type { SyncEngine } from "../data/sync-engine";

/** Ganchos para que el asistente IA interactúe con pestañas concretas. */
export interface AssistantHooks {
  prepareShiftClose?: (input: { opening_cash?: number; counted_cash?: number; withdrawn_cash?: number; next_opening_cash?: number; notes?: string }) => void;
  openReport?: (period: "day" | "accumulated" | "month" | string) => void;
}

export interface AppContext {
  store: Store<AppState>;
  config: PosConfig;
  client: SupabaseClient;
  auth: AuthService;
  tracker: ChangeTracker;
  repos: Repositories;
  sync: SyncEngine;
  branches: BranchService;
  settings: SettingsService;
  sales: SaleService;
  credit: CreditService;
  inventory: InventoryService;
  shifts: ShiftService;
  reports: ReportService;
  userAdmin: UserAdminService;
  toast: (message: string) => void;
  speak: (message: string) => void;
  hooks: AssistantHooks;
}
