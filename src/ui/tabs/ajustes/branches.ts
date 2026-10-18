import { html, setHtml } from "../../../core/html";
import { type Branch } from "../../../core/types";
import { openModal } from "../../components/modal";
import type { AppContext } from "../../context";

/** Sucursales (solo dueño): crear y editar (nombre, WhatsApp del corte, cierre automático). */
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
      html`${branches.map((branch) => {
        const numbers = [branch.whatsapp1, branch.whatsapp2].map((number) => (number || "").trim()).filter(Boolean);
        return html`
          <div class="list-item">
            <div class="item-line">
              <strong>${branch.name}</strong>
              ${branch.id === ctx.branches.operationalId() ? html`<span class="tag">Operativa actual</span>` : html``}
            </div>
            <p class="muted">
              ${numbers.length ? `Corte por WhatsApp: ${numbers.join(" y ")}` : "Sin WhatsApp para el corte"} ·
              ${branch.auto_close === false ? "cierre automático apagado" : "cierre automático a medianoche"}
            </p>
            <div class="actions">
              <button class="ghost" type="button" data-edit-branch="${branch.id}">Editar</button>
            </div>
          </div>
        `;
      })}`
    );
  };

  const openBranchForm = (branch?: Branch): void => {
    openModal({
      title: branch ? "Editar sucursal" : "Nueva sucursal",
      content: html`
        ${branch ? html`<p class="muted">${branch.id}</p>` : html`<p class="hint">La nueva sucursal arranca con existencias en cero; carga sus productos desde Inventario o Entradas.</p>`}
        <label class="form-field">Nombre
          <input id="bName" class="input" value="${branch?.name ?? ""}" placeholder="Ej. Sucursal Centro">
        </label>
        <div class="row">
          <label class="form-field">WhatsApp para el corte
            <input id="bWa1" class="input" type="tel" value="${branch?.whatsapp1 ?? ""}" placeholder="Opcional">
          </label>
          <label class="form-field">Segundo WhatsApp
            <input id="bWa2" class="input" type="tel" value="${branch?.whatsapp2 ?? ""}" placeholder="Opcional">
          </label>
        </div>
        <label class="check-option">
          <input id="bAuto" type="checkbox" ${branch?.auto_close === false ? null : "checked"}>
          Cerrar el corte solo a medianoche si no lo hago yo
        </label>
      `,
      actions: [
        { label: "Cancelar", kind: "ghost", onClick: (close) => close() },
        {
          label: branch ? "Guardar" : "Crear",
          kind: "primary",
          onClick: (close) => {
            const name = (document.getElementById("bName") as HTMLInputElement | null)?.value.trim() ?? "";
            if (!name) {
              ctx.toast("Escribe un nombre");
              return;
            }
            const whatsapp1 = (document.getElementById("bWa1") as HTMLInputElement | null)?.value.trim() ?? "";
            const whatsapp2 = (document.getElementById("bWa2") as HTMLInputElement | null)?.value.trim() ?? "";
            const autoClose = (document.getElementById("bAuto") as HTMLInputElement | null)?.checked ?? true;
            if (branch) ctx.branches.update(branch.id, { name, whatsapp1, whatsapp2, auto_close: autoClose });
            else {
              const created = ctx.branches.create(name);
              ctx.branches.update(created.id, { whatsapp1, whatsapp2, auto_close: autoClose });
            }
            close();
          }
        }
      ]
    });
  };

  root.querySelector<HTMLButtonElement>("#addBranch")!.addEventListener("click", () => openBranchForm());

  branchesList.addEventListener("click", (event) => {
    const button = (event.target as HTMLElement).closest<HTMLElement>("[data-edit-branch]");
    if (!button) return;
    const branch = ctx.branches.byId(button.dataset.editBranch ?? "");
    if (branch) openBranchForm(branch);
  });

  ctx.store.watch((s) => [s.branches, s.currentBranchId] as const, renderBranches);
  renderBranches();
  return { renderBranches };
}
