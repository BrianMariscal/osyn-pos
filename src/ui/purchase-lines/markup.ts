import { html } from "../../core/html";
import { fmtMoney, toCents } from "../../core/money";
import { fmtQty } from "../../core/qty";
import { isBulkUnit } from "../../core/units";
import type { Product } from "../../core/types";
import { searchProducts } from "../../domain/catalog";
import type { AppContext } from "../context";
import { iconFor } from "../icons";
import { baseQty } from "./lines";
import { packSizeOf, type LineState, type PurchaseLinesOptions } from "./types";

const SUGGESTIONS = 6;

/** Pista de la línea: equivalencia en piezas y costo por unidad. */
export function hintFor(ctx: AppContext, line: LineState): string {
  const product = ctx.repos.products.byId(line.productId);
  if (!product) return "";
  const units = baseQty(ctx, line);
  const parts: string[] = [];
  const size = packSizeOf(product);
  if (line.mode === "caja" && size) parts.push(`= ${fmtQty(units)} ${product.um} (${size} por caja)`);
  else if (size) parts.push(`Caja de ${size} ${product.um}`);
  const total = Number(line.total || 0);
  if (units > 0 && total > 0) parts.push(`${fmtMoney(Math.round(toCents(total) / units))} por ${product.um}`);
  return parts.join(" · ");
}

/** Buscador de producto: al escribir se elige solo el mejor resultado; los demás se pueden tocar. */
export function productField(ctx: AppContext, options: PurchaseLinesOptions, line: LineState, index: number, list: Product[]) {
  const supplierId = options.supplierId?.() ?? "";
  if (!list.length) {
    return html`<input class="input" name="producto" disabled placeholder="${supplierId ? "Este proveedor no tiene productos" : "No hay productos"}">`;
  }
  return html`
    <div class="combo-row">
      <input class="input" name="buscar" data-f="search" type="search" placeholder="Busca producto o código de barras" autocomplete="off"
        role="combobox" aria-label="Producto ${index + 1}" value="${line.search}">
      <button class="primary scan-btn" type="button" data-scan-line title="Escanear código de barras o QR" aria-label="Escanear producto ${index + 1}">${iconFor("barcode")}</button>
    </div>
    <div class="combo-pop">${comboPop(ctx, line, list)}</div>
  `;
}

export function comboPop(ctx: AppContext, line: LineState, list: Product[]) {
  const query = line.search.trim();
  const found = line.open && query ? searchProducts(list, query).slice(0, SUGGESTIONS) : [];
  const selected = ctx.repos.products.byId(line.productId);
  return html`
    ${line.open && query
      ? html`<div class="combo-list" role="listbox">
          ${found.length
            ? found.map(
                (p) => html`<button type="button" role="option" class="combo-option ${p.id === line.productId ? "active" : ""}" data-pick="${p.id}" aria-selected="${p.id === line.productId ? "true" : "false"}">
                  <span>${p.name}</span><small class="muted">${p.um}${p.cost ? ` · costo ${fmtMoney(toCents(p.cost))}` : ""}</small>
                </button>`
              )
            : html`<p class="combo-empty">Ningún producto coincide</p>`}
        </div>`
      : html``}
    ${selected && !line.open ? html`<span class="combo-picked">✓ ${selected.name} (${selected.um})</span>` : html``}
  `;
}

export function qtyMarkup(ctx: AppContext, line: LineState) {
  const product = ctx.repos.products.byId(line.productId);
  const size = packSizeOf(product);
  return html`
    <input class="input" name="cantidad" data-f="qty" type="number" step="${line.mode === "pza" && isBulkUnit(product?.um) ? "any" : "0.01"}" min="0.01" inputmode="decimal" placeholder="${line.mode === "caja" ? "Cajas" : "Cantidad"}" value="${line.qty}">
    ${size
      ? html`<select class="input" name="unidad" data-f="mode" aria-label="Unidad de compra">
          <option value="caja" ${line.mode === "caja" ? "selected" : null}>Cajas</option>
          <option value="pza" ${line.mode === "pza" ? "selected" : null}>${product?.um ?? "Pza"}</option>
        </select>`
      : html`<span class="unit-tag">${product?.um ?? "Pza"}</span>`}
  `;
}

export function lineMarkup(ctx: AppContext, options: PurchaseLinesOptions, line: LineState, index: number, list: Product[], canRemove: boolean) {
  return html`
    <div class="purchase-line" data-line="${index}">
      <div class="purchase-product combo">${productField(ctx, options, line, index, list)}</div>
      <div class="purchase-qty">${qtyMarkup(ctx, line)}</div>
      <input class="input" name="total" data-f="total" type="number" step="0.01" min="0" inputmode="decimal" placeholder="${options.requireTotal ? "Total pagado" : "Total pagado (opcional)"}" value="${line.total}">
      <button class="ghost danger" type="button" data-remove-line="${index}" aria-label="Quitar producto" ${canRemove ? null : "disabled"}>Quitar</button>
      <p class="hint purchase-hint" data-hint="${index}">${hintFor(ctx, line)}</p>
    </div>
  `;
}
