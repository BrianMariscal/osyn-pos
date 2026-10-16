import { nowISO } from "../core/dates";
import { SETTINGS_ROW_ID } from "../core/types";
import type { Settings } from "../core/types";

/** Fila falsa de producto que transporta los ajustes (id __pos_settings__). */
export function settingsProductRow(settings: Settings): Record<string, unknown> {
  const updatedAt = settings.updated_at || nowISO();
  return {
    id: SETTINGS_ROW_ID,
    name: "Configuración POS",
    category: "Sistema",
    cost: 0,
    price: 0,
    active: false,
    updated_at: updatedAt,
    settings
  };
}

const CLOUD_SETTING_KEYS = [
  "storeName",
  "logo",
  "whatsappNumber",
  "whatsapp2",
  "whatsapp3",
  "vendorTabs",
  "adminTabs",
  "assistantVoiceEnabled",
  "theme",
  "updated_at"
] as const;

/**
 * Normaliza ajustes venidos de la nube (fila __pos_settings__ o RPC
 * pos_settings). PostgREST devuelve el jsonb de la función TAL CUAL (objeto
 * plano), no envuelto en { settings }; se aceptan ambas formas. Solo pasan
 * claves conocidas para no contaminar el estado con basura.
 */
export function sanitizeCloudSettings(raw: unknown): Partial<Settings> | null {
  if (!raw || typeof raw !== "object") return null;
  const source = raw as Record<string, unknown>;
  const candidate =
    source.settings && typeof source.settings === "object"
      ? (source.settings as Record<string, unknown>)
      : source;
  const out: Record<string, unknown> = {};
  for (const key of CLOUD_SETTING_KEYS) {
    const value = candidate[key];
    if (value !== undefined) out[key] = value;
  }
  return Object.keys(out).length ? (out as Partial<Settings>) : null;
}
