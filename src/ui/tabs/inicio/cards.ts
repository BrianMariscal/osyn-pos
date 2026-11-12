import { html, setHtml, type SafeHtml } from "../../../core/html";
import { fmtMoney, fmtMoneyPesos, sumCents, toCents } from "../../../core/money";
import { type PeriodReport } from "../../../core/types";
import { daysInMonth, payrollProgress } from "../../../domain/expense-service";
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

// ---------------- Hoy (tarjeta principal) ----------------

export function renderHero(scene: InicioScene, scope: string, today: PeriodReport, month: PeriodReport, isManager: boolean): void {
  const { hourly, ui } = scene;
  const todayHours = hourly(scope, 0);
  const yesterdayHours = hourly(scope, 1);
  const nowHour = new Date().getHours();
  // Ayer a la misma hora: comparación justa a mitad del día
  const yesterdaySoFar = yesterdayHours.slice(0, nowHour + 1).reduce((a, b) => a + b, 0);
  const yesterdayTotal = yesterdayHours.reduce((a, b) => a + b, 0);
  const salesCents = toCents(today.sales_total);
  const avg = today.sales_count ? Math.round(salesCents / today.sales_count) : 0;
  const firstHour = Math.min(7, ...[...todayHours, ...yesterdayHours].map((c, h) => (c > 0 ? h : 24)));
  const lastHour = Math.max(21, nowHour, ...yesterdayHours.map((c, h) => (c > 0 ? h : 0)));
  const hours = Array.from({ length: lastHour - firstHour + 1 }, (_, i) => firstHour + i);
  const max = Math.max(1, ...hours.map((h) => Math.max(todayHours[h]!, yesterdayHours[h]!)));
  const stat = (label: string, value: string, tone: Tone): SafeHtml =>
    html`<div class="hero-stat" data-tone="${tone}"><span>${label}</span><strong>${value}</strong></div>`;
  setHtml(
    ui.heroCard,
    html`
      <div class="hero-top">
        <div>
          <span class="micro">Ventas de hoy</span>
          <strong class="hero-value">${fmtMoney(salesCents)}</strong>
          <div class="hero-deltas">
            ${deltaChip(salesCents, yesterdaySoFar, "vs ayer a esta hora")}
            <span class="muted">Ayer cerró en ${fmtMoney(yesterdayTotal)}</span>
          </div>
        </div>
        <div class="hero-stats">
          ${stat("Ventas", String(today.sales_count), "violet")}
          ${stat("Ticket promedio", fmtMoney(avg), "teal")}
          ${today.returns_total ? stat("Devoluciones", fmtMoneyPesos(today.returns_total), "coral") : html``}
          ${isManager ? stat("Margen bruto (hoy)", fmtMoneyPesos(today.gross_profit), "green") : html``}
          ${isManager ? stat("Utilidad del mes", fmtMoneyPesos(month.profit_after_expenses), month.profit_after_expenses < 0 ? "coral" : "green") : html``}
        </div>
      </div>
      ${isManager
        ? html`<p class="hint">Margen bruto = ventas − costo de lo vendido. Utilidad del mes = margen − costos fijos − gastos extra. Las compras de mercancía y las mermas se muestran aparte.</p>`
        : html``}
      <div class="hour-chart" role="img" aria-label="Ventas por hora: hoy contra ayer">
        ${hours.map((h) => {
          const t = todayHours[h]!;
          const y = yesterdayHours[h]!;
          return html`
            <div class="hour-col ${h === nowHour ? "now" : ""} ${h > nowHour ? "future" : ""}" title="${h}:00 · hoy ${fmtMoney(t)} · ayer ${fmtMoney(y)}">
              <div class="hour-bars">
                <span class="hour-y" style="height:${Math.round((y / max) * 100)}%"></span>
                <span class="hour-t" style="height:${h > nowHour ? 0 : Math.max(t > 0 ? 3 : 0, Math.round((t / max) * 100))}%"></span>
              </div>
              <span class="hour-label">${h % 2 === 0 || hours.length <= 12 ? `${h}` : ""}</span>
            </div>
          `;
        })}
      </div>
      <div class="chart-legend"><span class="lg-today"></span>Hoy <span class="lg-yesterday"></span>Ayer · ventas por hora</div>
    `
  );
}

// ---------------- Metas: día y nómina ----------------

function targetBreakdown(scene: InicioScene, scope: string): string {
  const parts = scene.ctx.expenses.fixedBreakdown(scope);
  return [
    parts.monthly > 0 ? `Mensuales ${fmtMoney(parts.monthly)} ÷ ${daysInMonth(new Date())} días` : "",
    parts.weekly > 0 ? `Semanales ${fmtMoney(parts.weekly)} ÷ 7` : ""
  ].filter(Boolean).join(" + ");
}

export function renderGoals(scene: InicioScene, scope: string, today: PeriodReport, month: PeriodReport): void {
  const { ctx, dayReport, ui } = scene;
  const monthly = ctx.expenses.monthlyFixedCents(scope);
  const payroll = ctx.expenses.payroll(scope);
  if (monthly <= 0 && payroll.weekly <= 0) {
    setHtml(
      ui.goalsCard,
      html`
        <div class="card-head"><h2>Metas</h2></div>
        <p class="hint">Registra tus costos fijos (renta, luz) y la nómina en Gastos: aquí verás cuánto necesitas ganar cada día y cuánto llevas para pagar sueldos.</p>
        <button class="ghost block section-gap" type="button" data-go="gastos">Registrar costos fijos</button>
      `
    );
    return;
  }
  const margin = month.sales_total > 0 ? month.gross_profit / month.sales_total : today.sales_total > 0 ? today.gross_profit / today.sales_total : 0;

  // Meta del día
  const target = ctx.expenses.dailyTargetCents(scope);
  const earned = toCents(today.gross_profit);
  const dayPct = target > 0 ? Math.max(0, Math.min(100, Math.round((earned / target) * 100))) : 0;
  const dayMissing = Math.max(0, target - earned);

  // Nómina de la semana (lunes a domingo)
  const now = new Date();
  const dayIndex = (now.getDay() + 6) % 7;
  let weekEarned = 0;
  for (let i = 0; i <= dayIndex; i += 1) weekEarned += toCents(dayReport(scope, i).gross_profit);
  const p = payrollProgress(payroll.weekly, weekEarned, now);

  setHtml(
    ui.goalsCard,
    html`
      <div class="card-head"><h2>Metas</h2></div>
      ${monthly > 0
        ? html`<div class="goal">
            <div class="goal-ring ${dayPct >= 100 ? "done" : ""}" style="--p:${dayPct}"><strong>${dayPct}%</strong></div>
            <div class="goal-text">
              <span class="micro">Meta del día · costos fijos</span>
              <strong>${fmtMoney(earned)} <small class="muted">de ${fmtMoney(target)}</small></strong>
              <span class="hint">${dayMissing > 0
                ? `Faltan ${fmtMoney(dayMissing)} de ganancia${margin > 0 ? ` (≈ vender ${fmtMoney(Math.round(dayMissing / margin))})` : ""}.`
                : "¡Meta del día cubierta!"}</span>
            </div>
          </div>`
        : html``}
      ${payroll.weekly > 0
        ? html`<div class="goal goal-payroll">
            <div class="goal-text">
              <span class="micro">Nómina de la semana</span>
              <strong>${fmtMoney(p.earned)} <small class="muted">de ${fmtMoney(p.goal)}</small></strong>
            </div>
            <div class="payroll-bar"><div style="width:${p.progress}%"></div></div>
            <span class="hint">${p.missing > 0
              ? `Faltan ${fmtMoney(p.missing)}: ${fmtMoney(p.perDay)} de ganancia por día ${p.daysLeft === 1 ? "(hoy es el último)" : `en los ${p.daysLeft} días que quedan`}.`
              : "✓ Nómina de la semana cubierta."}</span>
          </div>`
        : html`<button class="ghost block" type="button" data-go="gastos">Registrar nómina semanal</button>`}
      ${monthly > 0 ? html`<p class="micro goal-foot">${targetBreakdown(scene, scope)}</p>` : html``}
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

// ---------------- Mes ----------------

export function renderMonth(scene: InicioScene, scope: string, month: PeriodReport): void {
  const { ctx, ui } = scene;
  const sales = Math.max(month.sales_total, 0);
  const fixed = month.fixed_costs_total ?? 0;
  const extra = month.extra_expenses_total ?? month.expenses_total;
  const net = month.profit_after_expenses;
  const parts: Array<{ tone: Tone; label: string; value: number }> = [
    { tone: "amber", label: "Costo de mercancía", value: month.sales_cost },
    { tone: "coral", label: "Costos fijos", value: fixed },
    { tone: "violet", label: "Gastos extra", value: extra },
    { tone: "green", label: "Utilidad del mes", value: net }
  ];
  const base = Math.max(sales, month.sales_cost + fixed + extra, 1);
  setHtml(
    ui.monthCard,
    html`
      <div class="card-head">
        <div><h2>Este mes</h2><p class="hint">${scope === VIEW_ALL ? "Todas las sucursales" : ctx.branches.name(scope)}</p></div>
        <strong class="big-num">${fmtMoneyPesos(month.sales_total)}</strong>
      </div>
      <div class="stack-bar" role="img" aria-label="Cómo se reparten las ventas del mes">
        ${parts.filter((p) => p.value > 0).map((p) => html`<span data-tone="${p.tone}" style="width:${(p.value / base) * 100}%" title="${p.label}: ${fmtMoneyPesos(p.value)}"></span>`)}
      </div>
      <div class="legend-list">
        ${parts.map(
          (p) => html`<div data-tone="${p.tone}"><span class="legend-dot"></span><span>${p.label}</span><strong class="${p.tone === "green" && p.value < 0 ? "diff-negative" : ""}">${fmtMoneyPesos(p.value)}</strong></div>`
        )}
        <div class="legend-plain"><span>Compras a proveedores</span><strong>${fmtMoneyPesos(month.purchases_total)}</strong></div>
        ${month.mermas_total ? html`<div class="legend-plain"><span>Mermas</span><strong>${fmtMoneyPesos(month.mermas_total)}</strong></div>` : html``}
        ${month.returns_total ? html`<div class="legend-plain"><span>Devoluciones (ya restadas)</span><strong>${fmtMoneyPesos(month.returns_total)}</strong></div>` : html``}
      </div>
    `
  );
}
