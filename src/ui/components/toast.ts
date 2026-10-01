let container: HTMLElement | null = null;
let hideTimer: ReturnType<typeof setTimeout> | undefined;

export function initToast(root: HTMLElement): void {
  container = root;
  root.addEventListener("click", hide);
}

export function toast(message: string): void {
  if (!container) return;
  container.textContent = message;
  container.classList.add("show");
  if (hideTimer) clearTimeout(hideTimer);
  hideTimer = setTimeout(hide, 2600);
}

function hide(): void {
  if (!container) return;
  if (hideTimer) {
    clearTimeout(hideTimer);
    hideTimer = undefined;
  }
  container.classList.remove("show");
}
