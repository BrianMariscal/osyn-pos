import { html, setHtml, type SafeHtml } from "../../../core/html";
import { fmtMoney, fmtMoneyPesos, sumCents, toCents } from "../../../core/money";
import { type PeriodReport } from "../../../core/types";
import { payrollProgress } from "../../../domain/expense-service";
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

export function renderHero(scene: InicioScene, scope: string, today: PeriodReport, isManager: boolean): void {
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
          ${isManager ? stat("Ganancia de la mercancía (hoy)", fmtMoneyPesos(today.gross_profit), "green") : html``}
        </div>
      </div>
      ${isManager
        ? html`<p class="hint">Ganancia de la mercancía = ventas − costo. Lo que te queda libre = ganancia − gastos del mes. Las compras de mercancía y las mermas se muestran aparte.</p>`
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
  const partsText = [
    parts.monthly > 0 ? `${fmtMoney(parts.monthly)} al mes` : "",
    parts.weekly > 0 ? `${fmtMoney(parts.weekly)} por semana` : ""
  ].filter(Boolean).join(" + ");
  return partsText ? `Gastos fijos: ${partsText}` : "";
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

  // Sueldos de la semana (lunes a domingo)
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
              <span class="micro">Para cubrir gastos hoy</span>
              <strong>${fmtMoney(earned)} <small class="muted">de ${fmtMoney(target)}</small></strong>
              <span class="hint">${dayMissing > 0
                ? `Te faltan ${fmtMoney(dayMissing)} de ganancia${margin > 0 ? ` (≈ vender ${fmtMoney(Math.round(dayMissing / margin))})` : ""}.`
                : "¡Meta del día cubierta!"}</span>
            </div>
          </div>`
        : html``}
      ${payroll.weekly > 0
        ? html`<div class="goal goal-payroll">
            <div class="goal-text">
              <span class="micro">Sueldos de la semana</span>
              <strong>${fmtMoney(p.earned)} <small class="muted">de ${fmtMoney(p.goal)}</small></strong>
            </div>
            <div class="payroll-bar"><div style="width:${p.progress}%"></div></div>
            <span class="hint">${p.missing > 0
              ? `Te faltan ${fmtMoney(p.missing)}: ${fmtMoney(p.perDay)} por día ${p.daysLeft === 1 ? "(hoy es el último)" : `en los ${p.daysLeft} días que quedan`}.`
              : "✓ Sueldos de la semana cubiertos."}</span>
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
  const money = fmtMoneyPesos;
  const sales = Math.max(month.sales_total, 0);
  const cost = Math.max(month.sales_cost, 0);
  const gross = month.gross_profit;
  const fixed = month.fixed_costs_total ?? 0;
  const extra = month.extra_expenses_total ?? month.expenses_total;
  const expenses = fixed + extra;
  const net = month.profit_after_expenses;
  const coverage = expenses > 0 ? Math.max(0, Math.min(100, Math.round((gross / expenses) * 100))) : 100;
  const start = new Date(month.start);
  const now = new Date();
  const current = start.getFullYear() === now.getFullYear() && start.getMonth() === now.getMonth();
  const period = current
    ? "Este mes a la fecha"
    : start.toLocaleDateString("es-MX", { month: "long", year: "numeric" });
  const owed = Math.round(
    ctx.repos.customers
      .list()
      .filter((customer) => scene.inScope(scope, customer.branch_id))
      .reduce((sum, customer) => sum + customer.balance, 0) * 100
  ) / 100;
  setHtml(
    ui.monthCard,
    html`
      <div class="card-head">
        <div>
          <h2>¿Cómo va mi negocio?</h2>
          <p class="hint">${period} · ${scope === VIEW_ALL ? "Todas las sucursales" : ctx.branches.name(scope)}</p>
        </div>
        <div class="pnl-result ${net < 0 ? "neg" : "pos"}">
          <span>${net < 0 ? "Aún no cubres los gastos" : "Vas bien"}</span>
        </div>
      </div>
      <div class="pnl">
        <div class="pnl-row"><span>Vendiste</span><strong>${money(sales)}</strong></div>
        <div class="pnl-row sub"><span>− Lo que costó la mercancía</span><strong>${money(cost)}</strong></div>
        <div class="pnl-row total"><span>= Ganancia de la mercancía</span><strong>${money(gross)}</strong></div>
        <div class="pnl-row sub"><span>− Gastos fijos (parte de estos días)</span><strong>${money(fixed)}</strong></div>
        <div class="pnl-row sub"><span>− Otros gastos</span><strong>${money(extra)}</strong></div>
        <div class="pnl-row result ${net < 0 ? "neg" : "pos"}"><span>= Lo que te queda libre</span><strong>${money(net)}</strong></div>
      </div>
      ${expenses > 0
        ? html`<div class="pnl-progress">
            <div class="pnl-progress-head">
              <span>Tu ganancia de la mercancía cubre ${coverage}% de los gastos del mes</span>
              <strong>${money(gross)} de ${money(expenses)}</strong>
            </div>
            <div class="bar-track"><div class="bar-fill" style="width:${coverage}%"></div></div>
          </div>`
        : html``}
      <p class="hint pnl-note">${net < 0
        ? `Todavía no cubres los gastos del mes: te faltan ${money(Math.abs(net))} de ganancia. No significa que la caja esté vacía; las compras de mercancía y el fiado no cobrado no se cuentan aquí.`
        : `Ya cubriste los gastos del mes. Te quedan ${money(net)} libres después de pagar la mercancía y los gastos.`}</p>
      <div class="pnl-notes">
        <span>Gastos fijos prorrateados a los días transcurridos</span>
        <span>Compras de mercancía (inventario): ${money(month.purchases_total)}</span>
        <span>Mermas: ${money(month.mermas_total)}</span>
        <span>Fiado pendiente: ${money(owed)}</span>
        ${month.returns_total ? html`<span>Devoluciones (ya restadas): ${money(month.returns_total)}</span>` : html``}
      </div>
    `
  );
}
