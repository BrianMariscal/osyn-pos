import { html, setHtml } from "../../../core/html";
import { ALL_TABS, TAB_LABELS, VENDOR_CONFIGURABLE_TABS, type TabId } from "../../../core/types";
import { normalizeManagerTabs } from "../../../domain/normalize";
import { confirmDialog } from "../../components/modal";
import type { AppContext } from "../../context";

/** Sección Tienda: datos, logo, pantallas por rol y guardado de ajustes. */
export function createStoreSection(root: HTMLElement, ctx: AppContext): { renderForm(): void } {
  const form = root.querySelector<HTMLFormElement>("#settingsForm")!;
  const storeName = root.querySelector<HTMLInputElement>("#storeName")!;
  const logoFile = root.querySelector<HTMLInputElement>("#logoFile")!;
  const removeLogo = root.querySelector<HTMLButtonElement>("#removeLogo")!;
  const whatsapp = root.querySelector<HTMLInputElement>("#whatsappNumber")!;
  const whatsapp2 = root.querySelector<HTMLInputElement>("#whatsapp2")!;
  const whatsapp3 = root.querySelector<HTMLInputElement>("#whatsapp3")!;
  const logoPreview = root.querySelector<HTMLImageElement>("#logoPreview")!;
  const vendorTabsEl = root.querySelector<HTMLElement>("#vendorTabsSettings")!;
  const adminTabsEl = root.querySelector<HTMLElement>("#adminTabsSettings")!;
  const syncInfo = root.querySelector<HTMLElement>("#syncInfo")!;
  const panelsWrap = root.querySelector<HTMLElement>("#panelsWrap")!;
  const storeOwnerHint = root.querySelector<HTMLElement>("#storeOwnerHint")!;
  const saveStore = root.querySelector<HTMLButtonElement>("#saveStore")!;
  const savePanels = root.querySelector<HTMLButtonElement>("#savePanels")!;

  const renderForm = (): void => {
    const settings = ctx.store.getState().settings;
    const owner = ctx.auth.isOwner();
    storeOwnerHint.hidden = owner;
    panelsWrap.classList.toggle("hidden", !owner);
    saveStore.hidden = !owner;
    savePanels.hidden = !owner;
    [storeName, whatsapp, whatsapp2, whatsapp3].forEach((input) => {
      input.disabled = !owner;
    });
    logoFile.disabled = !owner;
    removeLogo.disabled = !owner;
    removeLogo.hidden = !settings.logo;
    storeName.value = settings.storeName || "";
    whatsapp.value = settings.whatsappNumber || "";
    whatsapp2.value = settings.whatsapp2 ?? "";
    whatsapp3.value = settings.whatsapp3 ?? "";
    logoPreview.classList.toggle("hidden", !settings.logo);
    if (settings.logo) logoPreview.src = settings.logo;
    const selected = new Set(settings.vendorTabs ?? []);
    setHtml(
      vendorTabsEl,
      html`${VENDOR_CONFIGURABLE_TABS.map(
        (tab) => html`
          <label class="check-option">
            <input type="checkbox" name="pantallaVendedor" value="${tab}" ${selected.has(tab) ? "checked" : null}>
            ${TAB_LABELS[tab as TabId]}
          </label>
        `
      )}`
    );
    if (owner) {
      const adminSelected = new Set(normalizeManagerTabs(settings.adminTabs));
      setHtml(
        adminTabsEl,
        html`${ALL_TABS.map(
          (tab) => html`
            <label class="check-option">
              <input type="checkbox" name="pantallaAdmin" value="${tab}" ${adminSelected.has(tab) ? "checked" : null}>
              ${TAB_LABELS[tab]}
            </label>
          `
        )}`
      );
    }
    const sync = ctx.store.getState().sync;
    syncInfo.textContent = sync.error
      ? `Error de sync: ${sync.error}`
      : sync.lastSyncAt
        ? `Última sync ${new Date(sync.lastSyncAt).toLocaleTimeString("es-MX", { hour: "2-digit", minute: "2-digit" })} · Pendientes ${sync.pending}`
        : "Sincronizando…";
  };

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const selected = [...vendorTabsEl.querySelectorAll<HTMLInputElement>("input:checked")]
      .map((input) => input.value as TabId)
      .filter((tab) => (VENDOR_CONFIGURABLE_TABS as readonly string[]).includes(tab));
    const adminSelected = [...adminTabsEl.querySelectorAll<HTMLInputElement>("input:checked")]
      .map((input) => input.value as TabId);
    const settings = ctx.store.getState().settings;
    ctx.settings.save({
      storeName: storeName.value.trim() || "Mi tienda",
      whatsappNumber: whatsapp.value.trim(),
      whatsapp2: whatsapp2.value.trim(),
      whatsapp3: whatsapp3.value.trim(),
      vendorTabs: selected.length ? selected : [...ctx.store.getState().settings.vendorTabs],
      adminTabs: ctx.auth.isOwner() ? (adminSelected.length ? adminSelected : [...ALL_TABS]) : (settings.adminTabs ?? [...ALL_TABS])
    });
    ctx.toast("Ajustes guardados");
  });

  /** Cualquier foto sirve: se reduce a 512px y se comprime antes de guardar. */
  const compressLogo = (file: File): Promise<string> =>
    new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(new Error("No se pudo leer la imagen"));
      reader.onload = () => {
        const img = new Image();
        img.onerror = () => reject(new Error("La imagen no es válida"));
        img.onload = () => {
          const max = 512;
          const scale = Math.min(1, max / Math.max(img.width, img.height));
          const canvas = document.createElement("canvas");
          canvas.width = Math.max(1, Math.round(img.width * scale));
          canvas.height = Math.max(1, Math.round(img.height * scale));
          const context = canvas.getContext("2d");
          if (!context) {
            resolve(String(reader.result ?? ""));
            return;
          }
          context.drawImage(img, 0, 0, canvas.width, canvas.height);
          // PNG conserva transparencia; JPEG pesa menos para fotos
          resolve(canvas.toDataURL(file.type === "image/png" ? "image/png" : "image/jpeg", 0.85));
        };
        img.src = String(reader.result ?? "");
      };
      reader.readAsDataURL(file);
    });

  logoFile.addEventListener("change", () => {
    const file = logoFile.files?.[0];
    if (!file) return;
    if (file.size > 15000000) {
      ctx.toast("La imagen es demasiado grande");
      return;
    }
    compressLogo(file)
      .then((logo) => {
        ctx.settings.save({ logo });
        ctx.toast("Logo guardado");
      })
      .catch((error: unknown) => ctx.toast(error instanceof Error ? error.message : "No se pudo guardar el logo"))
      .finally(() => {
        logoFile.value = "";
      });
  });

  removeLogo.addEventListener("click", async () => {
    const confirmed = await confirmDialog({
      title: "Quitar logo",
      message: "Se quitará el logo de la app en todos los dispositivos.",
      confirmLabel: "Quitar",
      danger: true
    });
    if (!confirmed) return;
    logoFile.value = "";
    ctx.settings.save({ logo: "" });
  });

  ctx.store.watch((s) => [s.settings, s.sync] as const, renderForm);
  renderForm();
  return { renderForm };
}
