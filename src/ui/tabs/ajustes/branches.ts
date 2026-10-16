import { html, setHtml } from "../../../core/html";
import { type Branch } from "../../../core/types";
import { openModal } from "../../components/modal";
import type { AppContext } from "../../context";

/** Sucursales (solo dueño): crear y renombrar. */
export function createBranchesSection(root: HTMLElement, ctx: AppContext): { renderBranches(): void } {
  const branchesSection = root.querySelector<HTMLElement>("#branchesSection")!;
  const branchesList = root.querySelector<HTMLElement>("#branchesList")!;
  const branchesHint = root.querySelector<HTMLElement>("#branchesHint")!;

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

  branchesList.addEventListener("click", (event) => {
    const button = (event.target as HTMLElement).closest<HTMLElement>("[data-rename-branch]");
    if (!button) return;
    const branch = ctx.branches.byId(button.dataset.renameBranch ?? "");
    if (branch) openBranchForm(branch);
  });

  ctx.store.watch((s) => [s.branches, s.currentBranchId] as const, renderBranches);
  renderBranches();
  return { renderBranches };
}
