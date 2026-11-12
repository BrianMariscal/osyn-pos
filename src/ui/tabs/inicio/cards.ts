import { html, setHtml, type SafeHtml } from "../../../core/html";
import { fmtMoney, fmtMoneyPesos, sumCents, toCents } from "../../../core/money";
import { type PeriodReport } from "../../../core/types";
import { VIEW_ALL } from "../../../domain/app-state";
import { type InicioScene, type Tone } from "./scene";

/** $1,234 → "$1.2k" para etiquetas de gráficas. */
export function fmtCompact(pesos: number): string {
  if (Math.abs(pesos) >= 1000) return `$${(pesos / 1000).toFixed(pesos >= 10000 ? 0 : 1)}k`;
  return `$${Math.round(pesos)}`;
}

/** Variación porcentual con flecha: ▲ 12 % / ▼ 5 %. */
export function deltaChip(current: number, previous: number, label: string): SafeHtml {
  if (previous <= 0) return current > 0 ? html`<span class="delta-chip up">Nuevo ${label}</span>` : html``;
  const pct = Math.round(((current - previous) / previous) * 100);
  const dir = pct > 0 ? "up" : pct < 0 ? "down" : "flat";
  return html`<span class="delta-chip ${dir}">${pct > 0 ? "▲" : pct < 0 ? "▼" : "="} ${Math.abs(pct)}% ${label}</span>`;
}

// ---------------- Hoy: resumen en cuatro cifras ----------------

export function renderHero(scene: InicioScene, scope: string, today: PeriodReport, month: PeriodReport, isManager: boolean): void {
  const { ctx, ui } = scene;
  const salesCents = toCents(today.sales_total);
  const avg = today.sales_count ? Math.round(salesCents / today.sales_count) : 0;
  const customers = ctx.repos.customers.list().filter((customer) => scene.inScope(scope, customer.branch_id));
  const owed = Math.round(customers.reduce((sum, customer) => sum + customer.balance, 0) * 100) / 100;
  const debtors = customers.filter((customer) => customer.balance > 0).length;
  const kpi = (label: string, value: string, hint: string, tone: Tone): SafeHtml =>
    html`<div class="hero-kpi" data-tone="${tone}"><span>${label}</span><strong>${value}</strong><small>${hint}</small></div>`;

  const kpis = isManager
    ? [
        kpi("Vendiste hoy", fmtMoneyPesos(today.sales_total), `${today.sales_count} ${today.sales_count === 1 ? "venta" : "ventas"}`, "blue"),
        kpi("Ganancia de hoy", fmtMoneyPesos(today.gross_profit), "Después de la mercancía", "green"),
        kpi("Gastos del mes", fmtMoneyPesos(month.expenses_total), "Renta, luz, sueldos y otros", "coral"),
        kpi("Te deben", fmtMoneyPesos(owed), `${debtors} ${debtors === 1 ? "cliente" : "clientes"}`, "amber")
      ]
    : [
        kpi("Vendiste hoy", fmtMoneyPesos(today.sales_total), `${today.sales_count} ${today.sales_count === 1 ? "venta" : "ventas"}`, "blue"),
        kpi("Ticket promedio", fmtMoneyPesos(avg), "Por venta", "teal"),
        kpi("Devoluciones", fmtMoneyPesos(today.returns_total ?? 0), "Del día", "coral")
      ];

  setHtml(ui.heroCard, html`<div class="hero-kpis">${kpis}</div>`);
}

// ---------------- Para hoy ----------------

export function renderGoals(scene: InicioScene, scope: string, today: PeriodReport, month: PeriodReport): void {
  const { ctx, ui } = scene;
  const target = ctx.expenses.dailyTargetCents(scope);
  const earned = toCents(today.gross_profit);
  const dayPct = target > 0 ? Math.max(0, Math.min(100, Math.round((earned / target) * 100))) : 0;
  const dayMissing = Math.max(0, target - earned);
  const margin = month.sales_total > 0 ? month.gross_profit / month.sales_total : today.sales_total > 0 ? today.gross_profit / today.sales_total : 0;

  if (target <= 0) {
    setHtml(
      ui.goalsCard,
      html`
        <div class="card-head"><h2>Para hoy</h2></div>
        <p class="hint">Aún no hay gastos fijos. Agrega la renta, la luz o los sueldos para saber cuánto necesitas ganar al día.</p>
        <button class="ghost block" type="button" data-go="gastos">Agregar gastos fijos</button>
      `
    );
    return;
  }

  setHtml(
    ui.goalsCard,
    html`
      <div class="card-head"><h2>Para hoy</h2></div>
      <div class="goal">
        <div class="goal-ring ${dayPct >= 100 ? "done" : ""}" style="--p:${dayPct}"><strong>${dayPct}%</strong></div>
        <div class="goal-text">
          <span class="micro">Ganancia de hoy</span>
          <strong>${fmtMoney(earned)} <small class="muted">de ${fmtMoney(target)}</small></strong>
          <span class="hint">${dayMissing > 0
            ? `Te faltan ${fmtMoney(dayMissing)} para cubrir los gastos de hoy${margin > 0 ? ` (≈ vender ${fmtMoney(Math.round(dayMissing / margin))})` : ""}.`
            : "¡Ya cubriste los gastos de hoy!"}</span>
        </div>
      </div>
      <p class="hint">Los gastos fijos se reparten entre los días del mes; si hoy no alcanza, no significa que pierdas.</p>
    `
  );
}

// ---------------- Semana ----------------

export function renderWeek(scene: InicioScene, scope: string, monthReport: PeriodReport): void {
  const { ctx, dayReport, dayStart, ui } = scene;
  const days = Array.from({ length: 7 }, (_, i) => {
    const offset = 6 - i;
    const report = dayReport(scope, offset);
    const date = dayStart(offset);
    return {
      weekday: date.toLocaleDateString("es-MX", { weekday: "short" }).replace(".", ""),
      day: date.getDate(),
      cents: toCents(report.sales_total),
      count: report.sales_count
    };
  });
  let prevCents = 0;
  for (let offset = 7; offset < 14; offset += 1) prevCents += toCents(dayReport(scope, offset).sales_total);
  const weekCents = sumCents(days.map((d) => d.cents));
  const max = Math.max(...days.map((d) => d.cents), 1);
  const avg = Math.round(weekCents / 7);
  const lastShift = ctx.shifts.lastShift(ctx.branches.operationalId());
  setHtml(
    ui.weekCard,
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
        <div data-tone="blue"><span>Ventas del mes</span><strong>${fmtMoneyPesos(monthReport.sales_total)}</strong></div>
        <div data-tone="coral"><span>Gastos extra hoy</span><strong>${fmtMoneyPesos(dayReport(scope, 0).extra_expenses_total ?? 0)}</strong></div>
        <div data-tone="teal"><span>Base para el siguiente turno</span><strong>${fmtMoneyPesos(lastShift?.next_opening_cash ?? 0)}</strong></div>
      </div>
    `
  );
}

// ---------------- Mes: resumen, no reporte ----------------

export function renderMonth(scene: InicioScene, scope: string, month: PeriodReport): void {
  const { ctx, ui } = scene;
  const money = fmtMoneyPesos;
  const sales = Math.max(month.sales_total, 0);
  const gross = month.gross_profit;
  const expenses = month.expenses_total;
  const net = month.profit_after_expenses;
  const coverage = expenses > 0 ? Math.max(0, Math.min(100, Math.round((gross / expenses) * 100))) : 100;
  const start = new Date(month.start);
  const now = new Date();
  const current = start.getFullYear() === now.getFullYear() && start.getMonth() === now.getMonth();
  const period = current
    ? "Este mes a la fecha"
    : start.toLocaleDateString("es-MX", { month: "long", year: "numeric" });

  setHtml(
    ui.monthCard,
    html`
      <div class="card-head">
        <div><h2>Este mes</h2><p class="hint">${period} · ${scope === VIEW_ALL ? "Todas las sucursales" : ctx.branches.name(scope)}</p></div>
        <button class="link-btn" type="button" data-go="reportes">Ver reporte completo</button>
      </div>
      <div class="month-lines">
        <div><span>Vendiste</span><strong>${money(sales)}</strong></div>
        <div><span>Ganancia después de la mercancía</span><strong>${money(gross)}</strong></div>
        <div><span>Gastos</span><strong>${money(expenses)}</strong></div>
        <div class="month-net ${net < 0 ? "neg" : "pos"}"><span>Te queda</span><strong>${money(net)}</strong></div>
      </div>
      <div class="month-progress">
        <div class="bar-track"><div class="bar-fill" style="width:${coverage}%"></div></div>
        <p class="hint">${net < 0
          ? `Cubres ${coverage}% de los gastos del mes. Te faltan ${money(Math.abs(net))} de ganancia.`
          : `Cubres ${coverage}% de los gastos del mes. Te quedan ${money(net)}.`}</p>
      </div>
      <p class="hint">Gastos incluye renta, luz, sueldos y otros. No incluye compras de mercancía ni fiado; eso está en Reportes.</p>
    `
  );
}
