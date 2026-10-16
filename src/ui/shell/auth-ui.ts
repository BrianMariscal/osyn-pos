import { closeAllModals } from "../components/modal";
import type { AppContext } from "../context";
import { allowedTabsChanged, refreshActiveTab, renderTabsNav } from "./nav";

export function wirePasswordToggles(): void {
  document.addEventListener("click", (event) => {
    const toggle = (event.target as HTMLElement).closest<HTMLElement>("[data-toggle-pass]");
    if (!toggle) return;
    const input = document.getElementById(toggle.dataset.togglePass ?? "") as HTMLInputElement | null;
    if (!input) return;
    const show = input.type === "password";
    input.type = show ? "text" : "password";
    toggle.textContent = show ? "Ocultar" : "Ver";
    input.focus();
  });
}

export function wireLogin(ctx: AppContext): void {
  const form = document.getElementById("loginForm") as HTMLFormElement | null;
  form?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const email = (document.getElementById("loginEmail") as HTMLInputElement).value.trim();
    const password = (document.getElementById("loginPassword") as HTMLInputElement).value;
    const button = form.querySelector<HTMLButtonElement>("button[type=submit]")!;
    button.disabled = true;
    try {
      await ctx.auth.login(email, password);
      (document.getElementById("loginPassword") as HTMLInputElement).value = "";
      ctx.toast("Sesión iniciada");
      // Recarga con el snapshot y la cola offline aislados para este usuario.
      window.location.reload();
    } catch (error) {
      ctx.toast(error instanceof Error ? error.message : "No se pudo iniciar sesión");
    } finally {
      button.disabled = false;
    }
  });
}

export function renderAuthState(ctx: AppContext): void {
  const loggedIn = ctx.auth.isAuthenticated;
  document.getElementById("loginScreen")?.classList.toggle("hidden", loggedIn);
  document.getElementById("appShell")?.classList.toggle("hidden", !loggedIn);
  if (!loggedIn) {
    closeAllModals();
    return;
  }
  ctx.branches.ensureSeeded();
  renderTabsNav(ctx);
  allowedTabsChanged(ctx);
  refreshActiveTab(ctx);
  const avatar = document.getElementById("sessionButton");
  if (avatar) avatar.classList.remove("hidden");
  const sessionName = document.getElementById("sessionName");
  if (sessionName) {
    const name = ctx.auth.displayName();
    sessionName.textContent = name;
    sessionName.classList.toggle("hidden", !name);
  }
  // El asistente SIEMPRE está disponible con sesión: en iPhone no hay dictado
  // (Web Speech API) y el chat funciona escribiendo; solo el micrófono se oculta.
  document.getElementById("assistantFab")?.classList.toggle("hidden", !ctx.auth.isAuthenticated);
  void ctx.sync.syncNow({ quiet: true });
}
