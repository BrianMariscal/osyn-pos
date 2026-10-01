/**
 * HTML seguro: el tagged template `html` escapa TODOS los valores por defecto.
 * Para insertar HTML ya construido (otro `html` anidado) usa `safe()` — es el
 * único punto por donde puede pasar HTML sin escapar. La regla de lint prohíbe
 * `innerHTML` directo fuera de `setHtml`.
 */
const ESCAPES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  "'": "&#39;",
  '"': "&quot;"
};

export function esc(value: unknown): string {
  return String(value ?? "").replace(/[&<>'"]/g, (c) => ESCAPES[c] ?? c);
}

export interface SafeHtml {
  readonly __safe: string;
}

export function safe(value: string): SafeHtml {
  return { __safe: value };
}

function isSafe(value: unknown): value is SafeHtml {
  return typeof value === "object" && value !== null && "__safe" in value;
}

export function html(strings: TemplateStringsArray, ...values: unknown[]): SafeHtml {
  let out = "";
  for (let i = 0; i < strings.length; i += 1) {
    out += strings[i];
    if (i >= values.length) break;
    const value = values[i];
    if (value === null || value === undefined || value === false) continue;
    if (isSafe(value)) {
      out += value.__safe;
    } else if (Array.isArray(value)) {
      out += value.map((item) => (isSafe(item) ? item.__safe : esc(item))).join("");
    } else {
      out += esc(value);
    }
  }
  return safe(out);
}

/** Único lugar autorizado a tocar innerHTML. */
export function setHtml(el: HTMLElement, content: SafeHtml): void {
  el.innerHTML = content.__safe;
}
