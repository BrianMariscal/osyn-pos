import { safe } from "../../core/html";
import type { AppContext } from "../context";

export type ThemeChoice = "light" | "dark" | "auto";
const THEME_KEY = "pos-theme";

/** El tema es preferencia de cada dispositivo (antes viajaba en los ajustes y cambiaba el de todos). */
export function themeChoice(ctx: AppContext): ThemeChoice {
  try {
    const local = localStorage.getItem(THEME_KEY);
    if (local === "light" || local === "dark" || local === "auto") return local;
  } catch {
    /* almacenamiento no disponible */
  }
  return ctx.store.getState().settings.theme ?? "auto";
}

export function setThemeChoice(ctx: AppContext, choice: ThemeChoice): void {
  try {
    localStorage.setItem(THEME_KEY, choice);
  } catch {
    /* almacenamiento no disponible */
  }
  applyTheme(ctx);
}

const svg = (body: string) =>
  safe(`<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`);
export const THEME_OPTIONS = [
  { id: "light", label: "Claro", icon: svg('<circle cx="12" cy="12" r="4"/><path d="M12 2.5v2M12 19.5v2M4.6 4.6 6 6M18 18l1.4 1.4M2.5 12h2M19.5 12h2M4.6 19.4 6 18M18 6l1.4-1.4"/>') },
  { id: "dark", label: "Oscuro", icon: svg('<path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5Z"/>') },
  { id: "auto", label: "Auto", icon: svg('<rect x="3" y="4.5" width="18" height="12" rx="2"/><path d="M8.5 20h7M12 16.5V20"/>') }
] as const satisfies ReadonlyArray<{ id: ThemeChoice; label: string; icon: ReturnType<typeof safe> }>;

export function wireThemeToggle(ctx: AppContext): void {
  document.addEventListener("click", (event) => {
    const button = (event.target as HTMLElement).closest<HTMLElement>("[data-theme-toggle]");
    if (!button) return;
    const dark = document.documentElement.dataset.theme === "dark";
    setThemeChoice(ctx, dark ? "light" : "dark");
  });
}

export function applyTheme(ctx: AppContext): void {
  const preference = themeChoice(ctx);
  const dark = preference === "dark" || (preference === "auto" && window.matchMedia?.("(prefers-color-scheme: dark)").matches);
  document.documentElement.dataset.theme = dark ? "dark" : "light";
  const meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
  if (meta) meta.content = dark ? "#161b22" : "#ffffff";
  document.querySelectorAll<HTMLElement>("[data-theme-toggle]").forEach((button) => {
    button.textContent = dark ? "☀" : "☾";
  });
}
