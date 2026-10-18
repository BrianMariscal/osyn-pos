import { esc, html, setHtml } from "../../core/html";

export interface ModalAction {
  label: string;
  kind?: "primary" | "ghost" | "danger";
  onClick?: (close: () => void) => void;
}

export interface ModalOptions {
  title: string;
  content: ReturnType<typeof html>;
  actions?: ModalAction[];
  onOpen?: (root: HTMLElement, close: () => void) => void;
  /** Se llama al cerrarse por cualquier vía (botón, ✕, fondo o Escape). */
  onClose?: () => void;
  /** Selector del elemento que recibe el foco al abrir (por defecto, el primero). */
  initialFocus?: string;
}

let openCount = 0;
/** Modales abiertos, en orden: Escape cierra solo el de hasta arriba. */
const modalStack: HTMLElement[] = [];

export function openModal(options: ModalOptions): () => void {
  const backdrop = document.createElement("div");
  backdrop.className = "modal-backdrop";
  setHtml(
    backdrop,
    html`
      <div class="modal" role="dialog" aria-modal="true" aria-label="${options.title}">
        <header class="modal-head">
          <h2>${options.title}</h2>
          <button class="modal-close ghost" type="button" aria-label="Cerrar">✕</button>
        </header>
        <div class="modal-body">${options.content}</div>
        <footer class="modal-actions">
          ${(options.actions ?? []).map(
            (action) =>
              html`<button class="${action.kind ?? "primary"}" type="button" data-modal-action="${esc(action.label)}">${action.label}</button>`
          )}
        </footer>
      </div>
    `
  );

  let closed = false;
  const close = (): void => {
    if (closed) return;
    closed = true;
    backdrop.remove();
    document.removeEventListener("keydown", onKey);
    const stackIndex = modalStack.indexOf(backdrop);
    if (stackIndex >= 0) modalStack.splice(stackIndex, 1);
    openCount = Math.max(0, openCount - 1);
    if (!openCount) document.body.classList.remove("modal-open");
    options.onClose?.();
  };

  backdrop.addEventListener("click", (event) => {
    const target = event.target as HTMLElement;
    if (target === backdrop || target.closest(".modal-close")) close();
    const actionButton = target.closest<HTMLElement>("[data-modal-action]");
    if (actionButton) {
      const action = (options.actions ?? []).find((a) => a.label === actionButton.dataset.modalAction);
      if (action?.onClick) action.onClick(close);
      else close();
    }
  });
  function onKey(event: KeyboardEvent): void {
    // Con modales apilados (p. ej. escáner + producto nuevo), Escape cierra
    // solo el de hasta arriba.
    if (event.key === "Escape" && modalStack[modalStack.length - 1] === backdrop) close();
  }
  document.addEventListener("keydown", onKey);

  document.body.appendChild(backdrop);
  modalStack.push(backdrop);
  openCount += 1;
  document.body.classList.add("modal-open");
  options.onOpen?.(backdrop, close);
  // El foco va al primer campo de captura; si no hay, al primer botón (antes
  // el ✕ del encabezado se llevaba el foco y en celular no salía el teclado).
  const focusTarget =
    (options.initialFocus ? backdrop.querySelector<HTMLElement>(options.initialFocus) : null) ??
    backdrop.querySelector<HTMLElement>("input, select, textarea") ??
    backdrop.querySelector<HTMLElement>("button");
  focusTarget?.focus();
  return close;
}

export function confirmDialog(options: {
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
  /** Si se define, el usuario debe escribir exactamente esta palabra. */
  keyword?: string;
}): Promise<boolean> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (value: boolean): void => {
      if (settled) return;
      settled = true;
      resolve(value);
    };
    const content = options.keyword
      ? html`
          <p>${options.message}</p>
          <label class="form-field">
            Escribe <strong>${options.keyword}</strong> para confirmar
            <input class="input" type="text" id="confirmKeyword" autocomplete="off">
          </label>
        `
      : html`<p>${options.message}</p>`;
    openModal({
      title: options.title,
      content,
      // Descartarlo con ✕/fondo/Escape cuenta como "no".
      onClose: () => finish(false),
      actions: [
        { label: options.cancelLabel ?? "Cancelar", kind: "ghost", onClick: (close) => { finish(false); close(); } },
        {
          label: options.confirmLabel ?? "Confirmar",
          kind: options.danger ? "danger" : "primary",
          onClick: (close) => {
            if (options.keyword) {
              const input = document.querySelector<HTMLInputElement>("#confirmKeyword");
              if (!input || input.value.trim() !== options.keyword) return;
            }
            // Primero se resuelve el valor y después se cierra: close() dispara
            // onClose (finish(false)) y, al ir después, ya no tiene efecto.
            finish(true);
            close();
          }
        }
      ]
    });
  });
}

export function promptDialog(options: {
  title: string;
  message?: string;
  type?: string;
  placeholder?: string;
  initial?: string;
  confirmLabel?: string;
  required?: boolean;
}): Promise<string | null> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (value: string | null): void => {
      if (settled) return;
      settled = true;
      resolve(value);
    };
    openModal({
      title: options.title,
      content: html`
        ${options.message ? html`<p>${options.message}</p>` : html``}
        <label class="form-field">
          <input class="input" type="${options.type ?? "text"}" id="promptInput" placeholder="${options.placeholder ?? ""}" value="${options.initial ?? ""}">
        </label>
      `,
      // Descartarlo con ✕/fondo/Escape cuenta como cancelar.
      onClose: () => finish(null),
      actions: [
        { label: "Cancelar", kind: "ghost", onClick: (close) => { finish(null); close(); } },
        {
          label: options.confirmLabel ?? "Aceptar",
          kind: "primary",
          onClick: (close) => {
            const input = document.querySelector<HTMLInputElement>("#promptInput");
            const value = input?.value.trim() ?? "";
            if (options.required && !value) return;
            // Resolver ANTES de cerrar: close() dispara onClose (finish(null)).
            finish(value);
            close();
          }
        }
      ],
      onOpen: (root, close) => {
        const input = root.querySelector<HTMLInputElement>("#promptInput");
        input?.focus();
        input?.addEventListener("keydown", (event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            const value = input.value.trim();
            if (options.required && !value) return;
            finish(value);
            close();
          }
        });
      }
    });
  });
}

export function closeAllModals(): void {
  document.querySelectorAll(".modal-backdrop").forEach((el) => el.remove());
  modalStack.length = 0;
  openCount = 0;
  document.body.classList.remove("modal-open");
}
