import { html, setHtml } from "../../../core/html";
import { ROLE_LABELS, type Role } from "../../../core/types";
import { confirmDialog, openModal } from "../../components/modal";
import type { AppContext } from "../../context";
import type { ManagedUser } from "../../../domain/user-admin-service";

/** Gestor de usuarios: el dueño administra todos, el admin solo vendedores. */
export function createUsersSection(root: HTMLElement, ctx: AppContext): { renderUsers(force?: boolean): Promise<void> } {
  const usersSection = root.querySelector<HTMLElement>("#usersSection")!;
  const usersList = root.querySelector<HTMLElement>("#usersList")!;
  const usersTitle = root.querySelector<HTMLElement>("#usersSection h2")!;
  const addUser = root.querySelector<HTMLButtonElement>("#addUser")!;
  let cachedUsers: ManagedUser[] = [];

  // Lista de usuarios: se muestra al instante con la última copia guardada y
  // se actualiza en segundo plano (antes se borraba y esperaba al servidor).
  const usersCacheKey = (): string => `pos-users-cache:${ctx.auth.session?.user?.id ?? "x"}`;
  const readUsersCache = (): ManagedUser[] | null => {
    try {
      const raw = localStorage.getItem(usersCacheKey());
      return raw ? (JSON.parse(raw) as ManagedUser[]) : null;
    } catch {
      return null;
    }
  };
  const writeUsersCache = (users: ManagedUser[]): void => {
    try {
      localStorage.setItem(usersCacheKey(), JSON.stringify(users));
    } catch {
      /* sin espacio: solo se pierde la copia rápida */
    }
  };
  const paintUsers = (users: ManagedUser[]): void => {
    cachedUsers = users;
    if (!users.length) {
      setHtml(usersList, html`<p class="muted">Sin usuarios.</p>`);
      return;
    }
    setHtml(
      usersList,
      html`${users.map(
        (user) => html`
          <div class="list-item item-line">
            <div>
              <strong>${user.name}</strong>
              <p class="muted">
                ${user.email} · ${ROLE_LABELS[user.role] ?? user.role}${user.branch_id ? ` · ${ctx.branches.name(user.branch_id)}` : user.role === "admin" ? " · Todas las sucursales" : ""}
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
  };
  let usersLoading: Promise<void> | null = null;
  let usersLoadedAt = 0;

  const renderUsers = async (force = false): Promise<void> => {
    if (!ctx.auth.isAdmin()) {
      usersSection.hidden = true;
      return;
    }
    usersSection.hidden = false;
    const owner = ctx.auth.isOwner();
    usersTitle.textContent = owner ? "Usuarios" : "Vendedores";
    addUser.textContent = owner ? "Agregar" : "Agregar vendedor";
    const cached = cachedUsers.length ? cachedUsers : readUsersCache();
    if (cached) paintUsers(cached);
    else setHtml(usersList, html`<p class="muted">Cargando usuarios…</p>`);
    // Se revisa con el servidor como máximo cada 20 s (o al guardar cambios)
    if (!force && Date.now() - usersLoadedAt < 20_000) return;
    if (usersLoading) return usersLoading;
    usersLoading = (async () => {
      try {
        const fresh = await ctx.userAdmin.list();
        usersLoadedAt = Date.now();
        writeUsersCache(fresh);
        paintUsers(fresh);
      } catch (error) {
        if (!cached) setHtml(usersList, html`<p class="muted">${error instanceof Error ? error.message : "No se pudieron cargar los usuarios"}</p>`);
      } finally {
        usersLoading = null;
      }
    })();
    return usersLoading;
  };

  const field = (id: string): HTMLInputElement | HTMLSelectElement =>
    document.getElementById(id) as HTMLInputElement | HTMLSelectElement;

  const openUserForm = (user?: ManagedUser): void => {
    const isOwner = ctx.auth.isOwner();
    const branches = ctx.branches.list();
    // Admin con sucursal: sus vendedores quedan en esa sucursal (el servidor lo exige igual)
    const myBranch = isOwner ? null : ctx.auth.assignedBranchId();
    const initialRole: Role = isOwner ? (user?.role ?? "empleado") : "empleado";
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
        ${myBranch
          ? html`<p class="hint">Sucursal: <b>${ctx.branches.name(myBranch)}</b> (la tuya).</p>`
          : html`<label class="form-field ${initialRole === "dueno" ? "hidden" : ""}" id="uBranchField"><span id="uBranchLabel">${initialRole === "admin" ? "Sucursal que administra" : "Sucursal del vendedor"}</span>
              <select id="uBranch" class="input">
                <option value="" id="uBranchNone">${initialRole === "admin" ? "Todas las sucursales" : "Sin sucursal"}</option>
                ${branches.map((branch) => html`<option value="${branch.id}" ${user?.branch_id === branch.id ? "selected" : null}>${branch.name}</option>`)}
              </select>
              <small class="hint" id="uBranchHint">${initialRole === "admin" ? "Con una sucursal, solo ve y opera esa sucursal. \"Todas\" puede cambiar entre sucursales y ver el consolidado." : ""}</small>
            </label>`}
        ${user ? html`<label class="form-field">Nueva contraseña (opcional)
          <span class="pass-field">
            <input id="uPassEdit" class="input" type="password" autocomplete="new-password">
            <button class="pass-toggle" type="button" data-toggle-pass="uPassEdit">Ver</button>
          </span>
        </label>` : html``}
      `,
      onOpen: (modalRoot) => {
        // Al cambiar el rol se ajusta el campo de sucursal
        const roleSelect = modalRoot.querySelector<HTMLSelectElement>("#uRole");
        roleSelect?.addEventListener("change", () => {
          const role = roleSelect.value as Role;
          modalRoot.querySelector("#uBranchField")?.classList.toggle("hidden", role === "dueno");
          const label = modalRoot.querySelector("#uBranchLabel");
          const none = modalRoot.querySelector("#uBranchNone");
          const hint = modalRoot.querySelector("#uBranchHint");
          if (label) label.textContent = role === "admin" ? "Sucursal que administra" : "Sucursal del vendedor";
          if (none) none.textContent = role === "admin" ? "Todas las sucursales" : "Sin sucursal";
          if (hint) {
            hint.textContent = role === "admin"
              ? "Con una sucursal, solo ve y opera esa sucursal. \"Todas\" puede cambiar entre sucursales y ver el consolidado."
              : "";
          }
        });
      },
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
            // El dueño no lleva sucursal; vendedor y administrador sí (admin vacío = todas)
            const branchId = role === "dueno" ? null : myBranch ?? (branchField ? branchField.value || null : null);
            const passInput = (document.getElementById("uPass") ?? document.getElementById("uPassEdit")) as HTMLInputElement | null;
            const pass = passInput?.value ?? "";
            void (async () => {
              try {
                if (user) {
                  await ctx.userAdmin.update({
                    user_id: user.user_id,
                    name,
                    role,
                    branch_id: branchId,
                    password: pass || undefined
                  });
                  ctx.toast("Usuario actualizado");
                } else {
                  const email = (field("uEmail") as HTMLInputElement).value.trim();
                  if (!email || pass.length < 8) {
                    ctx.toast("Escribe un correo y una contraseña de al menos 8 caracteres");
                    return;
                  }
                  await ctx.userAdmin.create({ email, password: pass, name: name || email, role, branch_id: branchId });
                  ctx.toast("Usuario creado");
                }
                close();
                void renderUsers(true);
              } catch (error) {
                ctx.toast(error instanceof Error ? error.message : "No se pudo guardar");
              }
            })();
          }
        }
      ]
    });
  };

  addUser?.addEventListener("click", () => openUserForm());

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
        void renderUsers(true);
      } catch (error) {
        ctx.toast(error instanceof Error ? error.message : "No se pudo eliminar");
      }
    }
  });

  return { renderUsers };
}
