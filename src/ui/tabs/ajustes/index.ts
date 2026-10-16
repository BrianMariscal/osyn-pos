import { clearSetupHash, hasSetupHash } from "../../../core/config";
import { setHtml } from "../../../core/html";
import { mountSections } from "../../sections";
import { mountVoiceSettings } from "../../voice-settings";
import type { TabModule } from "../tab-module";
import { wireBackupSection } from "./backup";
import { createBranchesSection } from "./branches";
import { ajustesMarkup } from "./markup";
import { createStoreSection } from "./store";
import { createUsersSection } from "./users";

export const ajustesTab: TabModule = {
  id: "ajustes",
  render(root, ctx) {
    setHtml(root, ajustesMarkup());

    // En celular: una sección a la vez (en computadora van lado a lado)
    const articles = [...root.querySelectorAll<HTMLElement>(":scope > .split > article")];
    mountSections(root, [
      { id: "tienda", label: "Tienda", el: articles[0] ?? null },
      { id: "usuarios", label: "Usuarios y sucursales", el: articles[1] ?? null }
    ]);

    const store = createStoreSection(root, ctx);
    const branches = createBranchesSection(root, ctx);
    const users = createUsersSection(root, ctx);
    wireBackupSection(root, ctx);

    // ---- Voz del asistente (configuración compartida) ----
    const voiceHost = root.querySelector<HTMLElement>("#voiceSettingsHost");
    if (voiceHost) mountVoiceSettings(voiceHost);

    // Refresca secciones según rol: al cambiar de sesión y cada vez que se abre
    // Ajustes (así Usuarios/Sucursales aparecen sin recargar la página).
    const refreshRoleViews = (): void => {
      store.renderForm();
      branches.renderBranches();
      void users.renderUsers();
    };
    ctx.auth.onSessionChange(refreshRoleViews);
    document.addEventListener("pos-tab-active", (event) => {
      if ((event as CustomEvent).detail === "ajustes") refreshRoleViews();
    });
    if (hasSetupHash()) {
      clearSetupHash();
      ctx.toast("Dispositivo configurado con Supabase");
    }
    void users.renderUsers();
  }
};
