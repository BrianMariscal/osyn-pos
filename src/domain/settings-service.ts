import { nowISO } from "../core/dates";
import type { Settings } from "../core/types";
import type { ChangeTracker } from "../data/change-tracker";
import { settingsProductRow } from "../data/sync-engine";
import type { AppState } from "./app-state";
import type { Store } from "./store";

export class SettingsService {
  constructor(
    private store: Store<AppState>,
    private tracker: ChangeTracker
  ) {}

  get(): Settings {
    return this.store.getState().settings;
  }

  save(partial: Partial<Settings>): void {
    this.store.update((state) => {
      state.settings = { ...state.settings, ...partial, updated_at: nowISO() };
    });
    // La fila __pos_settings__ viaja dentro de products (solo admin puede escribir).
    this.tracker.mark("products", "__pos_settings__");
  }
}

export { settingsProductRow };
