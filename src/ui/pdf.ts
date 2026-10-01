import { esc } from "../core/html";
import { fmtDateTime } from "../core/dates";
import { fmtMoneyPesos } from "../core/money";
import { fmtQty } from "../core/qty";
import type { InventoryCount, PeriodReport } from "../core/types";

const DOC_STYLE = `body{font-family:Arial,sans-serif;padding:28px;color:#14251f}h1{margin:0 0 6px}h2{margin-top:22px}table{width:100%;border-collapse:collapse;margin-top:12px}td,th{border:1px solid #ddd;padding:8px;text-align:left}.total{font-weight:bold;background:#f4f1e8}.muted{color:#666}.neg{color:#a83a32}.pos{color:#1f7a43}`;

/**
 * Imprimibles vía blob: URL (fin de document.write). Si el popup se bloquea,
 * se descarga el archivo HTML.
 */
export function openReportPdf(title: string, storeName: string, report: PeriodReport): void {
  const topRows = productRows(report.top_products, "No hubo ventas de productos en este periodo.");
  const slowRows = productRows(report.slow_products, "No hay productos registrados.");
  const rows: Array<[string, string]> = [
    ["Ventas", fmtMoneyPesos(report.sales_total)],
    ["Costo vendido", fmtMoneyPesos(report.sales_cost)],
    ["Ganancia bruta", fmtMoneyPesos(report.gross_profit)],
    ["Gastos", fmtMoneyPesos(report.expenses_total)],
    ["Compras proveedores", fmtMoneyPesos(report.purchases_total)],
    ["Mermas", fmtMoneyPesos(report.mermas_total)],
    ["Ganancia después de gastos", fmtMoneyPesos(report.profit_after_expenses)],
    ["Ventas fiadas", fmtMoneyPesos(report.credit_total)],
    ["Número de ventas", String(report.sales_count)],
    ["Gastos registrados", String(report.expenses_count)],
    ["Compras registradas", String(report.purchases_count)]
  ];
  const body = `
    <h1>${esc(storeName)}</h1>
    <h2>${esc(title)}</h2>
    <p class="muted">Generado: ${esc(fmtDateTime(new Date().toISOString()))}</p>
    <table><tbody>${rows
      .map(([label, value]) => `<tr class="${label.includes("después") ? "total" : ""}"><td>${label}</td><td>${esc(value)}</td></tr>`)
      .join("")}</tbody></table>
    <h2>Top 10 productos más vendidos</h2>
    <table><thead><tr><th>#</th><th>Producto</th><th>Cantidad</th><th>Total</th></tr></thead><tbody>${topRows}</tbody></table>
    <h2>10 productos con menos rotación</h2>
    <p class="muted">Incluye productos con cero venta en el periodo.</p>
    <table><thead><tr><th>#</th><th>Producto</th><th>Cantidad</th><th>Total</th></tr></thead><tbody>${slowRows}</tbody></table>`;
  openPrintable(title, body);
}

export function openCountPdf(storeName: string, count: InventoryCount): void {
  const summary = count.summary;
  const rows: Array<[string, string]> = [
    ["Productos capturados", String(summary.captured ?? 0)],
    ["Productos sin diferencia", String(summary.ok ?? 0)],
    ["Faltantes", String(summary.shortage ?? 0)],
    ["Sobrantes", String(summary.surplus ?? 0)],
    ["Ajustes aplicados", String(summary.adjusted ?? 0)],
    ["Impacto a costo", fmtMoneyPesos(summary.costImpact ?? 0)],
    ["Impacto a venta", fmtMoneyPesos(summary.saleImpact ?? 0)]
  ];
  const incidenceRows = (count.incidences ?? []).length
    ? count.incidences
        .map(
          (item, index) =>
            `<tr><td>${index + 1}</td><td>${esc(item.name)}</td><td>${esc(item.category || "Sin categoría")}</td>` +
            `<td>${esc(withUnit(item.system_stock, item.um))}</td><td>${esc(withUnit(item.physical_stock, item.um))}</td>` +
            `<td>${item.difference > 0 ? "+" : ""}${esc(withUnit(item.difference, item.um))}</td>` +
            `<td>${esc(fmtMoneyPesos(item.cost_impact))}</td><td>${esc(fmtMoneyPesos(item.sale_impact))}</td></tr>`
        )
        .join("")
    : `<tr><td colspan="8">No hubo diferencias para aplicar.</td></tr>`;
  const body = `
    <h1>${esc(storeName)}</h1>
    <h2>Ajustes de inventario aplicados</h2>
    <p class="muted">Conteo iniciado: ${esc(fmtDateTime(count.started_at))}</p>
    <p class="muted">Aplicado: ${esc(fmtDateTime(count.applied_at))}</p>
    <table><tbody>${rows.map(([label, value], i) => `<tr class="${i === 4 ? "total" : ""}"><td>${label}</td><td>${esc(value)}</td></tr>`).join("")}</tbody></table>
    <h2>Diferencias aplicadas</h2>
    <table><thead><tr><th>#</th><th>Producto</th><th>Categoría</th><th>Sistema</th><th>Físico</th><th>Diferencia</th><th>Impacto costo</th><th>Impacto venta</th></tr></thead><tbody>${incidenceRows}</tbody></table>`;
  openPrintable("Ajustes de inventario", body);
}

function productRows(rows: PeriodReport["top_products"], emptyMessage: string): string {
  if (!rows || !rows.length) return `<tr><td colspan="4">${esc(emptyMessage)}</td></tr>`;
  return rows
    .map(
      (row, index) =>
        `<tr><td>${index + 1}</td><td>${esc(row.name)}</td><td>${esc(withUnit(row.qty, row.um))}</td><td>${esc(fmtMoneyPesos(row.total))}</td></tr>`
    )
    .join("");
}

function withUnit(qty: number, um: string): string {
  return `${fmtQty(qty)} ${um || "Pza"}`;
}

function openPrintable(title: string, body: string): void {
  const doc = `<!doctype html><html lang="es"><head><meta charset="utf-8"><title>${esc(title)}</title><style>${DOC_STYLE}</style></head><body>${body}<script>window.print()<\/script></body></html>`;
  const blob = new Blob([doc], { type: "text/html;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const win = window.open(url, "_blank");
  if (!win) {
    const link = document.createElement("a");
    link.href = url;
    link.download = `${title}.html`;
    link.click();
  }
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}
