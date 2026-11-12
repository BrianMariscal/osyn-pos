import { dayRange, monthInputValue, toInputDateValue } from "../../../core/dates";
import { html, setHtml, type SafeHtml } from "../../../core/html";
import { fmtMoney, fmtMoneyPesos, sumCents, toCents } from "../../../core/money";
import type { AppContext } from "../../context";

/** $1,234 → "$1.2k" para etiquetas de gráficas. */
function fmtCompact(pesos: number): string {
  if (Math.abs(pesos) >= 1000) return `$${(pesos / 1000).toFixed(pesos >= 10000 ? 0 : 1)}k`;
  return `$${Math.round(pesos)}`;
}

/** Variación porcentual con flecha: ▲ 12 % / ▼ 5 %. */
function deltaChip(current: number, previous: number, label: string): SafeHtml {
  if (previous <= 0) return current > 0 ? html`<span class="delta-chip up">Nuevo ${label}</span>` : html``;
  const pct = Math.round(((current - previous) / previous) * 100);
  const dir = pct > 0 ? "up" : pct < 0 ? "down" : "flat";
  return html`<span class="delta-chip ${dir}">${pct > 0 ? "▲" : pct < 0 ? "▼" : "="} ${Math.abs(pct)}% ${label}</span>`;
}

/** Gráfica de los últimos 7 días, movida del inicio a Reportes. */
export function renderWeekReport(ctx: AppContext, el: HTMLElement, scope: string): void {
  const dayStart = (offset: number): Date => {
    const day = new Date();
    day.setHours(0, 0, 0, 0);
    day.setDate(day.getDate() - offset);
    return day;
  };
  const dayReport = (offset: number) => {
    const range = dayRange(toInputDateValue(dayStart(offset)));
    return ctx.reports.periodReport(scope, range.start, range.end);
  };

  const days = Array.from({ length: 7 }, (_, i) => {
    const offset = 6 - i;
    const report = dayReport(offset);
    const date = dayStart(offset);
    return {
      weekday: date.toLocaleDateString("es-MX", { weekday: "short" }).replace(".", ""),
      day: date.getDate(),
      cents: toCents(report.sales_total),
      count: report.sales_count
    };
  });
  let prevCents = 0;
  for (let offset = 7; offset < 14; offset += 1) prevCents += toCents(dayReport(offset).sales_total);
  const weekCents = sumCents(days.map((d) => d.cents));
  const max = Math.max(...days.map((d) => d.cents), 1);
  const avg = Math.round(weekCents / 7);
  const lastShift = ctx.shifts.lastShift(ctx.branches.operationalId());

  setHtml(
    el,
    html`
      <div class="card-head">
        <div><h2>Últimos 7 días</h2><p class="hint">Promedio ${fmtMoney(avg)} por día</p></div>
        <div class="align-right"><strong class="big-num">${fmtMoney(weekCents)}</strong>${deltaChip(weekCents, prevCents, "vs 7 días antes")}</div>
      </div>
      <div class="chart week-chart" role="img" aria-label="Ventas de los últimos 7 días">
        <div class="chart-avg" style="bottom:${Math.round((avg / max) * 100)}%"><span>prom.</span></div>
        ${days.map(
          (day, index) => html`
            <div class="chart-col ${index === days.length - 1 ? "today" : ""}" title="${day.weekday} ${day.day}: ${fmtMoney(day.cents)} · ${day.count} ventas">
              <span class="chart-val">${day.cents > 0 ? fmtCompact(day.cents / 100) : ""}</span>
              <div class="chart-bar" style="height:${Math.max(3, Math.round((day.cents / max) * 100))}%"></div>
              <span class="chart-label">${index === days.length - 1 ? "Hoy" : `${day.weekday} ${day.day}`}</span>
            </div>
          `
        )}
      </div>
      <div class="mini-stats">
        <div data-tone="blue"><span>Ventas del mes</span><strong>${fmtMoneyPesos(ctx.reports.monthReport(scope, monthInputValue()).sales_total)}</strong></div>
        <div data-tone="coral"><span>Gastos extra hoy</span><strong>${fmtMoneyPesos(dayReport(0).extra_expenses_total ?? 0)}</strong></div>
        <div data-tone="teal"><span>Base para el siguiente turno</span><strong>${fmtMoneyPesos(lastShift?.next_opening_cash ?? 0)}</strong></div>
      </div>
    `
  );
}
