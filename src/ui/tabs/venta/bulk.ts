import { html, type SafeHtml } from "../../../core/html";
import { fmtMoney, lineTotalCents } from "../../../core/money";
import { fmtQty } from "../../../core/qty";
import { type CartLine, type Product } from "../../../core/types";
import {
  AMOUNT_QUICK_PICKS,
  bulkQuickPicks,
  bulkSubunits,
  defaultBulkSubunit,
  fromBaseQty,
  qtyFromAmount,
  toBaseQty,
  type BulkSubunit
} from "../../../core/units";
import type { AppContext } from "../../context";

/** Captura a granel (peso, volumen e importe) de la pestaña Venta. */
export interface BulkTools {
  /** Preferencia por producto: subunidad (g/kg, ml/L) y modo importe. */
  of(product: Product): { subunit: BulkSubunit; amount: boolean };
  setPref(productId: string, pref: { subunitId?: string; amount?: boolean }): void;
  /** Cantidad en unidad base a partir de lo capturado (peso o importe). */
  baseFromInput(product: Product, amount: boolean, subunit: BulkSubunit, raw: string | number): number;
  /** Texto "= …" que se actualiza en vivo mientras se teclea. */
  previewText(product: Product, amount: boolean, base: number): string;
  /** Campo de báscula: cantidad + unidad (g/kg, ml/L) o importe, con atajos. */
  captureHtml(product: Product, line: CartLine): SafeHtml;
}

export function createBulkTools(ctx: AppContext): BulkTools {
  const prefs = new Map<string, { subunitId?: string; amount?: boolean }>();
  const of = (product: Product): { subunit: BulkSubunit; amount: boolean } => {
    const pref = prefs.get(product.id);
    const subunits = bulkSubunits(product.um);
    const subunit = subunits.find((s) => s.id === pref?.subunitId) ?? defaultBulkSubunit(product.um);
    return { subunit, amount: Boolean(pref?.amount) };
  };
  const setPref = (productId: string, pref: { subunitId?: string; amount?: boolean }): void => {
    prefs.set(productId, { ...prefs.get(productId), ...pref });
  };
  const baseFromInput = (product: Product, amount: boolean, subunit: BulkSubunit, raw: string | number): number => {
    const value = Number(String(raw).replace(",", "."));
    if (!Number.isFinite(value) || value <= 0) return 0;
    return amount ? qtyFromAmount(value, ctx.sales.unitPrice({ productId: product.id, qty: 0 })) : toBaseQty(value, subunit);
  };
  const previewText = (product: Product, amount: boolean, base: number): string => {
    if (base <= 0) return "= —";
    const price = ctx.sales.unitPrice({ productId: product.id, qty: 0 });
    return amount ? `= ${fmtQty(base)} ${product.um}` : `= ${fmtMoney(lineTotalCents(base, price))}`;
  };
  const captureHtml = (product: Product, line: CartLine): SafeHtml => {
    const price = ctx.sales.unitPrice(line);
    const { subunit, amount } = of(product);
    const inputValue = amount
      ? String(Number((lineTotalCents(line.qty, price) / 100).toFixed(2)))
      : String(Number(fromBaseQty(line.qty, subunit).toFixed(4)));
    const preview = amount ? `= ${fmtQty(line.qty)} ${product.um}` : `= ${fmtMoney(lineTotalCents(line.qty, price))}`;
    const chips = amount
      ? AMOUNT_QUICK_PICKS.map((value) => ({ base: qtyFromAmount(value, price), label: `$${value}` }))
      : bulkQuickPicks(product.um).map((pick) => ({ base: pick.qty, label: pick.label }));
    const step = amount ? 0.5 : subunit.id === "g" || subunit.id === "ml" ? 10 : 0.25;
    return html`
      <div class="bulk-capture" data-bulk>
        <div class="bulk-inputs">
          <input class="input" name="cantidad" type="number" min="0" step="${step}" value="${inputValue}" data-qty data-bulk-input inputmode="decimal" aria-label="Cantidad de ${product.name}${amount ? " en pesos" : ` en ${subunit.label}`}">
          <button type="button" class="bulk-unit ${amount ? "hidden" : ""}" data-bulk-unit title="Cambiar unidad">${subunit.label}</button>
          <button type="button" class="bulk-mode ${amount ? "active" : ""}" data-bulk-mode aria-pressed="${amount ? "true" : "false"}" title="Capturar por importe (ej. $20 de…)">$</button>
        </div>
        <span class="bulk-preview" data-bulk-preview aria-live="polite">${preview}</span>
        <div class="bulk-chips" data-bulk-chips>
          ${chips.map((chip) => html`<button type="button" class="bulk-chip" data-bulk-chip="${chip.base}">${chip.label}</button>`)}
        </div>
      </div>
    `;
  };
  return { of, setPref, baseFromInput, previewText, captureHtml };
}
