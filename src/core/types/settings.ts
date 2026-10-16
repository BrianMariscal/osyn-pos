import type { TabId } from "./tabs";

export type ThemePreference = "auto" | "light" | "dark";

export interface Settings {
  storeName: string;
  logo: string;
  whatsappNumber: string;
  whatsapp2?: string;
  whatsapp3?: string;
  vendorTabs: TabId[];
  /** Pestañas que ve el administrador (definidas por el dueño). Sin valor = todas. */
  adminTabs?: TabId[];
  assistantVoiceEnabled: boolean;
  theme: ThemePreference;
  updated_at: string;
}

export const SETTINGS_ROW_ID = "__pos_settings__";

/** Sucursal inicial que se crea por defecto; el dueño agrega más cuando quiera. */
export const DEFAULT_BRANCH_ID = "sucursal-1";
export const DEFAULT_BRANCH_NAME = "Sucursal 1";
