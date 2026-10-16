import { normalizeState } from "../../../domain/normalize";
import { confirmDialog } from "../../components/modal";
import type { AppContext } from "../../context";
import { downloadText } from "../download";

/** Respaldo: sincronizar, enlazar dispositivos, exportar e importar. */
export function wireBackupSection(root: HTMLElement, ctx: AppContext): void {
  root.querySelector<HTMLButtonElement>("#syncNow")!.addEventListener("click", () => {
    void ctx.sync.syncNow().then((result) => {
      if (result.ok) ctx.toast("Respaldo sincronizado");
      else ctx.toast(result.error ?? "No se pudo sincronizar");
    });
  });

  root.querySelector<HTMLButtonElement>("#copySetupLink")!.addEventListener("click", async () => {
    if (!ctx.config.supabaseUrl || !ctx.config.supabaseKey) {
      ctx.toast("Primero configura Supabase");
      return;
    }
    const link = `${location.origin}${location.pathname}#${new URLSearchParams({ supabaseUrl: ctx.config.supabaseUrl, supabaseKey: ctx.config.supabaseKey })}`;
    if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(link);
    else window.prompt("Copia este enlace en el otro dispositivo:", link);
    ctx.toast("Enlace copiado");
  });

  root.querySelector<HTMLButtonElement>("#exportData")!.addEventListener("click", () => {
    downloadText(
      `respaldo-abarrotes-${new Date().toISOString().slice(0, 10)}.json`,
      JSON.stringify(ctx.store.getState(), null, 2),
      "application/json"
    );
  });

  root.querySelector<HTMLInputElement>("#importData")!.addEventListener("change", async (event) => {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    try {
      const imported = normalizeState(JSON.parse(await file.text()));
      const confirmed = await confirmDialog({
        title: "Importar respaldo",
        message: "Se reemplazarán los datos locales con el respaldo y luego se sincronizarán con la nube.",
        confirmLabel: "Importar",
        danger: true
      });
      if (!confirmed) return;
      ctx.store.setState({ ...imported, sync: ctx.store.getState().sync });
      ctx.inventory.backfillFromProducts();
      ctx.toast("Respaldo importado");
      void ctx.sync.syncNow();
    } catch {
      ctx.toast("El archivo no es un respaldo válido");
    }
    input.value = "";
  });
}
