import { html, setHtml } from "../../core/html";
import { VENDOR_CONFIGURABLE_TABS, ROLE_LABELS, TAB_LABELS, ALL_TABS, type Role, type TabId, type Branch } from "../../core/types";
import { normalizeManagerTabs } from "../../domain/normalize";
import { clearSetupHash, hasSetupHash } from "../../core/config";
import { normalizeState } from "../../domain/normalize";
import { confirmDialog, openModal } from "../components/modal";
import { downloadText } from "./download";
import { mountVoiceSettings } from "../voice-settings";
import type { ManagedUser } from "../../domain/user-admin-service";
import type { TabModule } from "./tab-module";

export const ajustesTab: TabModule = {
  id: "ajustes",
  render(root, ctx) {
    setHtml(
      root,
      html`
        <div class="split">
          <article class="card">
            <h2>Tienda</h2>
            <p class="hint" id="storeOwnerHint" hidden>Solo el dueño puede modificar el nombre, el logo y el WhatsApp de la tienda.</p>
            <form id="settingsForm" class="form">
              <label class="form-field">Nombre
                <input id="storeName" class="input" placeholder="Mi tienda">
              </label>
              <label class="form-field">Logo
                <input id="logoFile" type="file" accept="image/*">
              </label>
              <button id="removeLogo" class="ghost danger" type="button">Quitar logo</button>
              <label class="form-field">WhatsApp para cortes (con lada)
                <input id="whatsappNumber" class="input" placeholder="5215512345678">
              </label>
              <div class="row">
                <label class="form-field">WhatsApp adicional 2
                  <input id="whatsapp2" class="input" placeholder="Opcional">
                </label>
                <label class="form-field">WhatsApp adicional 3
                  <input id="whatsapp3" class="input" placeholder="Opcional">
                </label>
              </div>
              <img id="logoPreview" class="login-logo hidden" alt="Logo actual">
              <button id="saveStore" class="primary" type="submit">Guardar</button>
            </form>

            <div id="panelsWrap">
              <h2>Pantallas del vendedor</h2>
              <p class="hint">Elige qué ve el usuario vendedor.</p>
              <div id="vendorTabsSettings" class="checkbox-grid"></div>

              <div id="adminTabsWrap">
                <h2>Pantallas del administrador</h2>
                <p class="hint">Elige qué ve el administrador. El dueño siempre ve todo.</p>
                <div id="adminTabsSettings" class="checkbox-grid"></div>
              </div>
            </div>
            <p class="hint" style="margin-top: var(--sp-3);">La voz del asistente se activa desde el menú de tu usuario (arriba a la derecha).</p>
            <div id="voiceSettingsHost" style="margin-top: var(--sp-3);"></div>
            <button id="savePanels" class="primary" type="submit" form="settingsForm" style="margin-top: var(--sp-3);">Guardar</button>
          </article>

          <article class="card">
            <div id="usersSection">
              <div class="section-title">
                <h2>Usuarios</h2>
                <button id="addUser" class="primary" type="button">Agregar</button>
              </div>
              <div id="usersList" class="list"></div>
            </div>

            <div id="branchesSection">
              <div class="section-title">
                <h2>Sucursales</h2>
                <button id="addBranch" class="primary" type="button">Agregar</button>
              </div>
              <p class="hint" id="branchesHint"></p>
              <div id="branchesList" class="list"></div>
            </div>

            <h2>Respaldo</h2>
            <p class="hint" id="syncInfo"></p>
            <div class="actions wrap-actions">
              <button id="syncNow" class="ghost" type="button">Sincronizar ahora</button>
              <button id="copySetupLink" class="ghost" type="button">Enlazar otro dispositivo</button>
              <button id="exportData" class="ghost" type="button">Exportar respaldo</button>
              <label class="import-label">Importar respaldo<input id="importData" type="file" accept="application/json"></label>
            </div>
          </article>
        </div>
      `
    );

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
    const usersSection = root.querySelector<HTMLElement>("#usersSection")!;
    const usersList = root.querySelector<HTMLElement>("#usersList")!;
    const branchesSection = root.querySelector<HTMLElement>("#branchesSection")!;
    const branchesList = root.querySelector<HTMLElement>("#branchesList")!;
    const branchesHint = root.querySelector<HTMLElement>("#branchesHint")!;
    const syncInfo = root.querySelector<HTMLElement>("#syncInfo")!;
    const panelsWrap = root.querySelector<HTMLElement>("#panelsWrap")!;
    const storeOwnerHint = root.querySelector<HTMLElement>("#storeOwnerHint")!;
    const saveStore = root.querySelector<HTMLButtonElement>("#saveStore")!;
    const savePanels = root.querySelector<HTMLButtonElement>("#savePanels")!;
    const usersTitle = root.querySelector<HTMLElement>("#usersSection h2")!;
    const addUser = root.querySelector<HTMLButtonElement>("#addUser")!;
    let cachedUsers: ManagedUser[] = [];

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
              <input type="checkbox" value="${tab}" ${selected.has(tab) ? "checked" : null}>
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
                <input type="checkbox" value="${tab}" ${adminSelected.has(tab) ? "checked" : null}>
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

    // ---- Gestor de usuarios: el dueño administra todos, el admin solo vendedores ----
    const renderUsers = async (): Promise<void> => {
      if (!ctx.auth.isAdmin()) {
        usersSection.hidden = true;
        return;
      }
      usersSection.hidden = false;
      const owner = ctx.auth.isOwner();
      usersTitle.textContent = owner ? "Usuarios" : "Vendedores";
      addUser.textContent = owner ? "Agregar" : "Agregar vendedor";
      setHtml(usersList, html`<p class="muted">Cargando…</p>`);
      try {
        cachedUsers = await ctx.userAdmin.list();
        if (!cachedUsers.length) {
          setHtml(usersList, html`<p class="muted">Sin usuarios.</p>`);
          return;
        }
        setHtml(
          usersList,
          html`${cachedUsers.map(
            (user) => html`
              <div class="list-item item-line">
                <div>
                  <strong>${user.name}</strong>
                  <p class="muted">
                    ${user.email} · ${ROLE_LABELS[user.role] ?? user.role}${user.branch_id ? ` · ${ctx.branches.name(user.branch_id)}` : ""}
                  </p>
                </div>
                <div class="actions">
                  <button class="ghost" type="button" data-edit-user="${user.user_id}">Editar</button>
                  <button class="ghost danger" type="button" data-delete-user="${user.user_id}">Eliminar</button>
                </div>
              </div>
            `
          )}`
        );
      } catch (error) {
        setHtml(usersList, html`<p class="muted">${error instanceof Error ? error.message : "No se pudieron cargar los usuarios"}</p>`);
      }
    };

    const field = (id: string): HTMLInputElement | HTMLSelectElement =>
      document.getElementById(id) as HTMLInputElement | HTMLSelectElement;

    const openUserForm = (user?: ManagedUser): void => {
      const isOwner = ctx.auth.isOwner();
      const branches = ctx.branches.list();
      const isEmployeeOnly = !isOwner || user?.role === "empleado";
      openModal({
        title: user ? (isOwner ? "Editar usuario" : "Editar vendedor") : isOwner ? "Nuevo usuario" : "Nuevo vendedor",
        content: html`
          <label class="form-field">Nombre
            <input id="uName" class="input" value="${user?.name ?? ""}">
          </label>
          ${user
            ? html`<p class="muted">${user.email}</p>`
            : html`
                <label class="form-field">Correo
                  <input id="uEmail" class="input" type="email" autocomplete="off">
                </label>
                <label class="form-field">Contraseña
                  <span class="pass-field">
                    <input id="uPass" class="input" type="password" autocomplete="new-password">
                    <button class="pass-toggle" type="button" data-toggle-pass="uPass">Ver</button>
                  </span>
                </label>
              `}
          ${isOwner
            ? html`<label class="form-field">Rol
                <select id="uRole" class="input">
                  <option value="dueno" ${user?.role === "dueno" ? "selected" : null}>Dueño</option>
                  <option value="admin" ${user?.role === "admin" ? "selected" : null}>Administrador</option>
                  <option value="empleado" ${user?.role === "empleado" || !user ? "selected" : null}>Vendedor</option>
                </select>
              </label>`
            : html``}
          ${isEmployeeOnly
            ? html`<label class="form-field">Sucursal del vendedor
                <select id="uBranch" class="input">
                  <option value="">Sin sucursal</option>
                  ${branches.map((branch) => html`<option value="${branch.id}" ${user?.branch_id === branch.id ? "selected" : null}>${branch.name}</option>`)}
                </select>
              </label>`
            : html``}
          ${user ? html`<label class="form-field">Nueva contraseña (opcional)
            <span class="pass-field">
              <input id="uPass" class="input" type="password" autocomplete="new-password">
              <button class="pass-toggle" type="button" data-toggle-pass="uPass">Ver</button>
            </span>
          </label>` : html``}
        `,
        actions: [
          { label: "Cancelar", kind: "ghost", onClick: (close) => close() },
          {
            label: user ? "Guardar" : "Crear",
            kind: "primary",
            onClick: (close) => {
              const name = (field("uName") as HTMLInputElement).value.trim();
              const roleSelect = field("uRole") as HTMLSelectElement | null;
              const role: Role = roleSelect ? (roleSelect.value as Role) : "empleado";
              const branchField = field("uBranch") as HTMLSelectElement | null;
              const branchId = branchField ? branchField.value || null : null;
              const pass = (document.getElementById("uPass") as HTMLInputElement | null)?.value ?? "";
              void (async () => {
                try {
                  if (user) {
                    await ctx.userAdmin.update({
                      user_id: user.user_id,
                      name,
                      role,
                      branch_id: role === "empleado" ? branchId : null,
                      password: pass || undefined
                    });
                    ctx.toast("Usuario actualizado");
                  } else {
                    const email = (field("uEmail") as HTMLInputElement).value.trim();
                    if (!email || pass.length < 6) {
                      ctx.toast("Escribe un correo y una contraseña de al menos 6 caracteres");
                      return;
                    }
                    await ctx.userAdmin.create({ email, password: pass, name: name || email, role, branch_id: role === "empleado" ? branchId : null });
                    ctx.toast("Usuario creado");
                  }
                  close();
                  void renderUsers();
                } catch (error) {
                  ctx.toast(error instanceof Error ? error.message : "No se pudo guardar");
                }
              })();
            }
          }
        ]
      });
    };

    root.querySelector<HTMLButtonElement>("#addUser")?.addEventListener("click", () => openUserForm());

    usersList.addEventListener("click", async (event) => {
      const target = event.target as HTMLElement;
      const editButton = target.closest<HTMLElement>("[data-edit-user]");
      if (editButton) {
        const user = cachedUsers.find((u) => u.user_id === editButton.dataset.editUser);
        if (user) openUserForm(user);
        return;
      }
      const deleteButton = target.closest<HTMLElement>("[data-delete-user]");
      if (deleteButton) {
        const user = cachedUsers.find((u) => u.user_id === deleteButton.dataset.deleteUser);
        if (!user) return;
        const confirmed = await confirmDialog({
          title: "Eliminar usuario",
          message: `Se eliminará a ${user.name} (${user.email}) y no podrá entrar de nuevo.`,
          confirmLabel: "Eliminar",
          danger: true,
          keyword: "ELIMINAR"
        });
        if (!confirmed) return;
        try {
          await ctx.userAdmin.remove(user.user_id);
          ctx.toast("Usuario eliminado");
          void renderUsers();
        } catch (error) {
          ctx.toast(error instanceof Error ? error.message : "No se pudo eliminar");
        }
      }
    });

    // ---- Sucursales (solo dueño): crear y renombrar ----
    const renderBranches = (): void => {
      if (!ctx.auth.isOwner()) {
        branchesSection.hidden = true;
        return;
      }
      branchesSection.hidden = false;
      const branches = ctx.branches.list();
      branchesHint.textContent = ctx.branches.isMultiBranch()
        ? "Cada sucursal tiene su propio stock, ventas y caja. El catálogo de productos es compartido."
        : "Tu tienda arranca con una sucursal. Agrega otra cuando la necesites: cada una tendrá su propio stock, ventas y caja; los productos son compartidos.";
      setHtml(
        branchesList,
        html`${branches.map(
          (branch) => html`
            <div class="list-item item-line">
              <div>
                <strong>${branch.name}</strong>
                <p class="muted">${branch.id === ctx.branches.operationalId() ? "Operativa actual" : branch.id}</p>
              </div>
              <button class="ghost" type="button" data-rename-branch="${branch.id}">Renombrar</button>
            </div>
          `
        )}`
      );
    };

    const openBranchForm = (branch?: Branch): void => {
      openModal({
        title: branch ? "Renombrar sucursal" : "Nueva sucursal",
        content: html`
          ${branch ? html`<p class="muted">${branch.id}</p>` : html`<p class="hint">La nueva sucursal arranca con existencias en cero; carga sus productos desde Inventario o Entradas.</p>`}
          <label class="form-field">Nombre
            <input id="bName" class="input" value="${branch?.name ?? ""}" placeholder="Ej. Sucursal Centro">
          </label>
        `,
        actions: [
          { label: "Cancelar", kind: "ghost", onClick: (close) => close() },
          {
            label: branch ? "Guardar" : "Crear",
            kind: "primary",
            onClick: (close) => {
              const name = (document.getElementById("bName") as HTMLInputElement).value.trim();
              if (!name) {
                ctx.toast("Escribe un nombre");
                return;
              }
              if (branch) ctx.branches.rename(branch.id, name);
              else ctx.branches.create(name);
              close();
            }
          }
        ]
      });
    };

    root.querySelector<HTMLButtonElement>("#addBranch")!.addEventListener("click", () => openBranchForm());

    // ---- Voz del asistente (configuración compartida) ----
    const voiceHost = root.querySelector<HTMLElement>("#voiceSettingsHost");
    if (voiceHost) mountVoiceSettings(voiceHost);

    branchesList.addEventListener("click", (event) => {
      const button = (event.target as HTMLElement).closest<HTMLElement>("[data-rename-branch]");
      if (!button) return;
      const branch = ctx.branches.byId(button.dataset.renameBranch ?? "");
      if (branch) openBranchForm(branch);
    });

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

    ctx.store.watch((s) => [s.settings, s.sync] as const, renderForm);
    renderForm();
    ctx.store.watch((s) => [s.branches, s.currentBranchId] as const, renderBranches);
    renderBranches();
    // Refresca secciones según rol: al cambiar de sesión y cada vez que se abre
    // Ajustes (así Usuarios/Sucursales aparecen sin recargar la página).
    const refreshRoleViews = (): void => {
      renderForm();
      renderBranches();
      void renderUsers();
    };
    ctx.auth.onSessionChange(refreshRoleViews);
    document.addEventListener("pos-tab-active", (event) => {
      if ((event as CustomEvent).detail === "ajustes") refreshRoleViews();
    });
    if (hasSetupHash()) {
      clearSetupHash();
      ctx.toast("Dispositivo configurado con Supabase");
    }
    void renderUsers();
  }
};
