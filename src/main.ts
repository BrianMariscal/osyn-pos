import "./styles/tokens.css";
import "./styles/base.css";
import "./styles/components.css";

import { readConfig } from "./core/config";
import { initMonitoring, setMonitoringUser } from "./core/monitoring";
import { Store } from "./domain/store";
import { createInitialState, type AppState } from "./domain/app-state";
import { normalizeState } from "./domain/normalize";
import { SupabaseClient } from "./data/supabase-client";
import { ChangeTracker } from "./data/change-tracker";
import { Repositories } from "./data/repositories";
import { SyncEngine } from "./data/sync-engine";
import { attachPersistence, attachTrackerPersistence, loadSnapshot, loadTracker } from "./data/persist";
import { loadAuthSession } from "./data/persist";
import { AuthService } from "./domain/auth-service";
import { BranchService } from "./domain/branch-service";
import { SettingsService } from "./domain/settings-service";
import { SaleService } from "./domain/sale-service";
import { CreditService } from "./domain/credit-service";
import { ReturnService } from "./domain/return-service";
import { InventoryService } from "./domain/inventory-service";
import { ShiftService } from "./domain/shift-service";
import { ReportService } from "./domain/report-service";
import { ExpenseService } from "./domain/expense-service";
import { UserAdminService } from "./domain/user-admin-service";
import { buildApp } from "./ui/app";
import { applyTheme } from "./ui/shell/theme";
import { toast } from "./ui/components/toast";
import { speak } from "./ui/voice-recognition";
import type { AppContext } from "./ui/context";

async function main(): Promise<void> {
  // Pide al navegador no desalojar IndexedDB por falta de espacio: ahí viven
  // las ventas offline que aún no suben a la nube.
  void navigator.storage?.persist?.().catch(() => false);
  const config = readConfig();
  initMonitoring(config.sentryDsn);
  const authSnapshot = loadAuthSession();
  const scope = authSnapshot?.user?.id || "guest";
  const snapshot = await loadSnapshot(scope);
  const initialState: AppState = snapshot ? normalizeState(snapshot) : createInitialState();
  const store = new Store<AppState>(initialState);
  attachPersistence(store, scope);

  const client = new SupabaseClient(config);
  const auth = new AuthService(client);
  const tracker = new ChangeTracker();
  tracker.restore(await loadTracker(scope));
  attachTrackerPersistence(tracker, scope);
  const repos = new Repositories(store, tracker);
  const sync = new SyncEngine(store, client, auth, tracker, repos);
  const branches = new BranchService(store, auth, repos);
  const settings = new SettingsService(store, tracker);
  const sales = new SaleService(store, repos, branches);
  const credit = new CreditService(repos);
  const returns = new ReturnService(store, repos, branches);
  const inventory = new InventoryService(repos, branches, () => Boolean(store.getState().sync.serverStock));
  const shifts = new ShiftService(repos, branches);
  const reports = new ReportService(repos, store);
  const expenses = new ExpenseService(repos, branches);
  const userAdmin = new UserAdminService(auth);

  const ctx: AppContext = {
    store,
    config,
    client,
    auth,
    tracker,
    repos,
    sync,
    branches,
    settings,
    sales,
    credit,
    returns,
    inventory,
    shifts,
    reports,
    expenses,
    userAdmin,
    toast,
    speak: (message) => speak(message, store.getState().settings.assistantVoiceEnabled),
    hooks: {}
  };

  if (auth.session?.refresh_token) {
    try {
      await auth.refreshIfNeeded();
      if (auth.isAuthenticated) await auth.loadProfile();
      else toast("Sesión expirada, inicia de nuevo");
    } catch (error) {
      toast(error instanceof Error ? error.message : "Sesión expirada");
    }
  }

  const reportUser = (): void => {
    const session = auth.session;
    setMonitoringUser(session ? { id: session.user.id, role: session.role, branch: session.branch_id } : null);
  };
  reportUser();
  auth.onSessionChange(reportUser);

  buildApp(ctx);
  applyTheme(ctx);

  if (auth.isAuthenticated) {
    branches.ensureSeeded();
    const recovered = inventory.backfillFromProducts();
    if (recovered > 0) toast(`${recovered} productos recuperados del respaldo anterior`);
    void sync.syncNow({ quiet: true });
  }

  window.matchMedia?.("(prefers-color-scheme: dark)")?.addEventListener?.("change", () => applyTheme(ctx));
}

void main();
