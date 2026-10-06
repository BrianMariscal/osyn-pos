/**
 * Iconos del sistema (SVG inline, trazo 1.8, heredan currentColor).
 * Mismo lenguaje visual que el resto del diseño: línea fina, esquinas suaves.
 */
import { safe, type SafeHtml } from "../core/html";

function icon(paths: string, viewBox = "0 0 24 24"): SafeHtml {
  return safe(
    `<svg viewBox="${viewBox}" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`
  );
}

export const ICONS = {
  cart: icon('<circle cx="9" cy="20" r="1.6"/><circle cx="17" cy="20" r="1.6"/><path d="M3 3h2.2l2.4 12.2a1.6 1.6 0 0 0 1.6 1.3h8.3a1.6 1.6 0 0 0 1.6-1.2L21 7H6"/>'),
  home: icon('<path d="M3.5 10.5 12 3.5l8.5 7"/><path d="M5.5 9.5V20h13V9.5"/><path d="M10 20v-5.5h4V20"/>'),
  box: icon('<path d="M12 3 20 7v10l-8 4-8-4V7z"/><path d="M4 7l8 4 8-4"/><path d="M12 11v9"/>'),
  layers: icon('<path d="M12 3 21 8l-9 5-9-5z"/><path d="m3 13 9 5 9-5"/><path d="m3 17.5 9 5 9-5"/>'),
  wallet: icon('<path d="M4 7.5A2.5 2.5 0 0 1 6.5 5h11A2.5 2.5 0 0 1 20 7.5v9a2.5 2.5 0 0 1-2.5 2.5h-11A2.5 2.5 0 0 1 4 16.5z"/><path d="M15 12h5v4h-5a2 2 0 1 1 0-4z"/>'),
  receipt: icon('<path d="M6 3h12v18l-2.4-1.8L13.2 21l-2.4-1.8L8.4 21 6 19.2z"/><path d="M9 8h6M9 12h6"/>'),
  truck: icon('<path d="M2.5 6h11v10h-11z"/><path d="M13.5 9.5H18l3 3.5v3h-7.5"/><circle cx="6.5" cy="18.5" r="1.8"/><circle cx="17" cy="18.5" r="1.8"/>'),
  calculator: icon('<rect x="5" y="3" width="14" height="18" rx="2"/><path d="M8.5 7h7"/><path d="M8.5 12h.01M12 12h.01M15.5 12h.01M8.5 15.5h.01M12 15.5h.01M15.5 15.5h.01M8.5 19h.01M12 19h.01M15.5 19h.01"/>'),
  chart: icon('<path d="M4 4v16h16"/><path d="M8 16v-5M12.5 16V8M17 16v-3"/>'),
  gear: icon('<circle cx="12" cy="12" r="3.2"/><path d="M12 2.8v2.4M12 18.8v2.4M2.8 12h2.4M18.8 12h2.4M5.5 5.5l1.7 1.7M16.8 16.8l1.7 1.7M18.5 5.5l-1.7 1.7M7.2 16.8l-1.7 1.7"/>'),
  barcode: icon('<path d="M4 6.5V4h2.5M17.5 4H20v2.5M20 17.5V20h-2.5M6.5 20H4v-2.5"/><path d="M7.5 8v8M10.5 8v8M13.5 8v8M16.5 8v8"/>'),
  plus: icon('<path d="M12 5v14M5 12h14"/>'),
  download: icon('<path d="M12 4v11M7.5 11 12 15.5 16.5 11"/><path d="M5 19h14"/>'),
  upload: icon('<path d="M12 15V4M7.5 8.5 12 4l4.5 4.5"/><path d="M5 19h14"/>'),
  alert: icon('<path d="M12 4 2.8 19.5h18.4z"/><path d="M12 10v4.5"/><path d="M12 17.2v.01"/>'),
  trash: icon('<path d="M4 7h16M9.5 7V4.5h5V7M6.5 7l1 13h9l1-13"/><path d="M10 11v5M14 11v5"/>'),
  edit: icon('<path d="M4 20h4.5L20 8.5a2.1 2.1 0 0 0-3-3L5.5 17z"/><path d="M14.5 7 17 9.5"/>'),
  arrowDown: icon('<path d="M12 5v13M6.5 12.5 12 18l5.5-5.5"/>'),
  arrowUp: icon('<path d="M12 19V6M6.5 11.5 12 6l5.5 5.5"/>'),
  mic: icon('<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0"/><path d="M12 18v3"/>'),
  search: icon('<circle cx="11" cy="11" r="6.5"/><path d="m16 16 4.5 4.5"/>'),
  card: icon('<rect x="3" y="5.5" width="18" height="13" rx="2"/><path d="M3 10h18M7 15h3"/>'),
  transfer: icon('<path d="M4 8h14l-3.5-3.5M20 16H6l3.5 3.5"/>'),
  user: icon('<circle cx="12" cy="8.2" r="3.4"/><path d="M5.2 19c1.5-3.1 4-4.7 6.8-4.7s5.3 1.6 6.8 4.7"/>')
};

/** Icono por pestaña (el id de pestaña no coincide con el nombre del icono). */
export const TAB_ICONS: Record<string, keyof typeof ICONS> = {
  venta: "cart",
  inicio: "home",
  entradas: "arrowDown",
  productos: "box",
  inventario: "layers",
  mermas: "alert",
  fiado: "wallet",
  gastos: "receipt",
  proveedores: "truck",
  corte: "calculator",
  reportes: "chart",
  ajustes: "gear"
};

/** Color pastel por grupo de navegación (identidad por sección). */

/** Icono como SafeHtml para insertar en templates html``. */
export function iconFor(name: keyof typeof ICONS): SafeHtml {
  return ICONS[name];
}
