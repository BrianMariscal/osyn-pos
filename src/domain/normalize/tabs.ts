import { z } from "zod";
import { ALL_TABS, DEFAULT_ADMIN_TABS, DEFAULT_VENDOR_TABS, VENDOR_CONFIGURABLE_TABS } from "../../core/types";
import type { TabId } from "../../core/types";

/**
 * Normaliza la lista de pestañas del vendedor y migra el default antiguo
 * ("venta,fiado") al nuevo default amplio — los dispositivos que guardaron el
 * valor de fábrica viejo quedan actualizados sin tocar la nube.
 */
export function normalizeVendorTabs(values: unknown): TabId[] {
  const valid = Array.isArray(values)
    ? values.filter((v): v is TabId => typeof v === "string" && (VENDOR_CONFIGURABLE_TABS as readonly string[]).includes(v))
    : [];
  if (!valid.length) return [...DEFAULT_VENDOR_TABS];
  const oldDefault = valid.length === 2 && valid.every((v) => v === "venta" || v === "fiado");
  return oldDefault ? [...DEFAULT_VENDOR_TABS] : valid;
}

export const tabsSchema = z
  .array(z.string())
  .catch([])
  .transform(normalizeVendorTabs);

/** Pestañas del administrador: solo las válidas; si no hay ninguna, todas. */
export function normalizeManagerTabs(values: unknown): TabId[] {
  const valid = Array.isArray(values)
    ? values.filter((v): v is TabId => typeof v === "string" && (ALL_TABS as readonly string[]).includes(v))
    : [];
  return valid.length ? valid : [...DEFAULT_ADMIN_TABS];
}

export const adminTabsSchema = z
  .array(z.string())
  .catch([])
  .transform(normalizeManagerTabs);
