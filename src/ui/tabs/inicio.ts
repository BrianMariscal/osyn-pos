import { html, setHtml, type SafeHtml } from "../../core/html";
import { dayRange, monthInputValue, todayInputValue, toInputDateValue } from "../../core/dates";
import { fmtMoney, fmtMoneyPesos, sumCents, toCents } from "../../core/money";
import { PAYMENT_LABELS, type PaymentMethod, type PeriodReport } from "../../core/types";
import { daysInMonth, payrollProgress } from "../../domain/expense-service";
import { isRevenueSale } from "../../domain/sale-groups";
import { fmtQty } from "../../core/qty";
import { VIEW_ALL } from "../../domain/app-state";
import { iconFor } from "../icons";
import { lazyRender } from "../lazy-render";
import type { TabModule } from "./tab-module";

type RankPeriod = "day" | "week" | "month";
type Tone = "blue" | "teal" | "green" | "amber" | "coral" | "violet";

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

const PAYMENT_TONES: Record<string, Tone> = { efectivo: "green", transferencia: "blue", tarjeta: "violet", fiado: "amber", interno: "teal" };

export const inicioTab: TabModule = {
  id: "inicio",
  render(root, ctx) {
    setHtml(
      root,
      html`
        <header class="dash-head">
          <div id="greeting"></div>
          <div class="dash-actions">
            <div id="scopeChips"></div>
            <button class="primary" type="button" data-go="venta">${iconFor("cart")} Nueva venta</button>
            <button class="ghost hide-sm" type="button" data-go="corte" id="goCorte">${iconFor("calculator")} Corte de caja</button>
          </div>
        </header>
        <div class="dash">
          <section class="card hero-card span-2" id="heroCard"></section>
          <section class="card goals-card" id="goalsCard"></section>
          <section class="card span-2" id="weekCard"></section>
          <section class="card" id="monthCard"></section>
          <section class="card" id="rankCard">
            <div class="card-head card-head-stack">
              <h2>Lo más vendido</h2>
              <div class="chips" id="rankPeriod">
                <button class="chip chip-active" type="button" data-rank="day">Hoy</button>
                <button class="chip" type="button" data-rank="week">Semana</button>
                <button class="chip" type="button" data-rank="month">Mes</button>
              </div>
            </div>
            <div id="rankBody"></div>
          </section>
          <section class="card" id="lowCard"></section>
          <section class="card" id="creditCard"></section>
        </div>
      `
    );

    const scopeChips = root.querySelector<HTMLElement>("#scopeChips")!;
    const greetingEl = root.querySelector<HTMLElement>("#greeting")!;
    const heroCard = root.querySelector<HTMLElement>("#heroCard")!;
    const goalsCard = root.querySelector<HTMLElement>("#goalsCard")!;
    const weekCard = root.querySelector<HTMLElement>("#weekCard")!;
    const monthCard = root.querySelector<HTMLElement>("#monthCard")!;
    const rankCard = root.querySelector<HTMLElement>("#rankCard")!;
    const lowCard = root.querySelector<HTMLElement>("#lowCard")!;
    const creditCard = root.querySelector<HTMLElement>("#creditCard")!;
    const rankBodyEl = root.querySelector<HTMLElement>("#rankBody")!;
    const rankPeriodEl = root.querySelector<HTMLElement>("#rankPeriod")!;
    const managerOnly = [weekCard, monthCard, rankCard, lowCard, creditCard];

    let rankPeriod: RankPeriod = "day";

    const dayStart = (offsetDays: number): Date => {
      const day = new Date();
      day.setHours(0, 0, 0, 0);
      day.setDate(day.getDate() - offsetDays);
      return day;
    };
    const dayReport = (scope: string, offsetDays: number): PeriodReport => {
      const range = dayRange(toInputDateValue(dayStart(offsetDays)));
      return ctx.reports.periodReport(scope, range.start, range.end);
    };
    const inScope = (scope: string, branchId: string | null | undefined): boolean => scope === VIEW_ALL || branchId === scope;

    /** Ventas por hora de un día (centavos), solo ventas con ingreso. */
    const hourly = (scope: string, offsetDays: number): number[] => {
      const start = dayStart(offsetDays).toISOString();
      const end = dayStart(offsetDays - 1).toISOString();
      const hours = new Array<number>(24).fill(0);
      for (const sale of ctx.repos.sales.list()) {
        if (!inScope(scope, sale.branch_id) || sale.created_at < start || sale.created_at >= end || !isRevenueSale(sale)) continue;
        hours[new Date(sale.created_at).getHours()]! += toCents(sale.total);
      }
      return hours;
    };

    const renderGreeting = (isManager: boolean, isOwner: boolean): void => {
      const hour = new Date().getHours();
      const saludo = hour < 12 ? "Buenos días" : hour < 19 ? "Buenas tardes" : "Buenas noches";
      const firstName = ctx.auth.displayName();
      const date = new Date().toLocaleDateString("es-MX", { weekday: "long", day: "numeric", month: "long" });
      const sub = isOwner ? "Resumen de tu negocio" : isManager ? "Operación de la sucursal" : "Tus ventas de hoy";
      setHtml(greetingEl, html`<h2>${saludo}${firstName ? `, ${firstName}` : ""}</h2><p class="hint dash-date">${date} · ${sub}</p>`);
    };

    // ---------------- Hoy (tarjeta principal) ----------------

    const renderHero = (scope: string, today: PeriodReport, isManager: boolean): void => {
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
        heroCard,
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
              ${isManager ? stat("Ganancia bruta", fmtMoneyPesos(today.gross_profit), "green") : html``}
              ${isManager ? stat("Ganancia neta", fmtMoneyPesos(today.profit_after_expenses), today.profit_after_expenses < 0 ? "coral" : "green") : html``}
            </div>
          </div>
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
    };

    // ---------------- Metas: día y nómina ----------------

    const targetBreakdown = (scope: string): string => {
      const parts = ctx.expenses.fixedBreakdown(scope);
      return [
        parts.monthly > 0 ? `Mensuales ${fmtMoney(parts.monthly)} ÷ ${daysInMonth(new Date())} días` : "",
        parts.weekly > 0 ? `Semanales ${fmtMoney(parts.weekly)} ÷ 7` : ""
      ].filter(Boolean).join(" + ");
    };

    const renderGoals = (scope: string, today: PeriodReport, month: PeriodReport): void => {
      const monthly = ctx.expenses.monthlyFixedCents(scope);
      const payroll = ctx.expenses.payroll(scope);
      if (monthly <= 0 && payroll.weekly <= 0) {
        setHtml(
          goalsCard,
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
        goalsCard,
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
          ${monthly > 0 ? html`<p class="micro goal-foot">${targetBreakdown(scope)}</p>` : html``}
        `
      );
    };

    // ---------------- Semana ----------------

    const renderWeek = (scope: string, monthReport: PeriodReport): void => {
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
        weekCard,
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
    };

    // ---------------- Mes ----------------

    const renderMonth = (scope: string, month: PeriodReport): void => {
      const sales = Math.max(month.sales_total, 0);
      const fixed = month.fixed_costs_total ?? 0;
      const extra = month.extra_expenses_total ?? month.expenses_total;
      const net = month.profit_after_expenses;
      const parts: Array<{ tone: Tone; label: string; value: number }> = [
        { tone: "amber", label: "Costo de mercancía", value: month.sales_cost },
        { tone: "coral", label: "Costos fijos", value: fixed },
        { tone: "violet", label: "Gastos extra", value: extra },
        { tone: "green", label: "Ganancia neta", value: net }
      ];
      const base = Math.max(sales, month.sales_cost + fixed + extra, 1);
      setHtml(
        monthCard,
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
          </div>
        `
      );
    };

    // ---------------- Más vendido ----------------

    const barRow = (tone: Tone, label: string, value: string, ratio: number, sub = ""): SafeHtml => html`
      <div class="bar-row" data-tone="${tone}">
        <div class="bar-row-head"><span>${label}${sub ? html` <small class="muted">${sub}</small>` : html``}</span><strong>${value}</strong></div>
        <div class="bar-track"><div class="bar-fill" style="width:${Math.max(2, Math.round(Math.min(1, ratio) * 100))}%"></div></div>
      </div>
    `;

    const renderRank = (scope: string): void => {
      let report: PeriodReport;
      if (rankPeriod === "week") {
        const start = new Date();
        start.setDate(start.getDate() - 6);
        report = ctx.reports.periodReport(scope, dayRange(toInputDateValue(start)).start, dayRange(todayInputValue()).end);
      } else if (rankPeriod === "month") {
        report = ctx.reports.monthReport(scope, monthInputValue());
      } else {
        report = dayReport(scope, 0);
      }
      const top = report.top_products.slice(0, 5);
      const notSold = report.slow_products.filter((stat) => stat.qty === 0);
      const maxQty = Math.max(...top.map((stat) => stat.qty), 1);
      const periodLabel = rankPeriod === "week" ? "esta semana" : rankPeriod === "month" ? "este mes" : "hoy";
      const tones: Tone[] = ["blue", "teal", "violet", "amber", "green"];
      setHtml(
        rankBodyEl,
        html`
          ${top.length
            ? html`<div class="bar-list">${top.map((stat, index) =>
                barRow(tones[index % tones.length]!, `${index + 1}. ${stat.name}`, fmtMoneyPesos(stat.total), stat.qty / maxQty, `${fmtQty(stat.qty)} ${stat.um}`)
              )}</div>`
            : html`<p class="empty-note">Aún no hay ventas ${periodLabel}.</p>`}
          ${notSold.length
            ? html`<p class="micro section-gap">Sin ventas ${periodLabel} (${notSold.length})</p>
                <div class="chips chips-wrap">${notSold.slice(0, 8).map((stat) => html`<span class="chip chip-muted">${stat.name}</span>`)}</div>`
            : html``}
        `
      );
    };

    // ---------------- Por agotarse ----------------

    const renderLow = (scope: string): void => {
      const lowStock = ctx.repos.stocks
        .list()
        .filter((row) => inScope(scope, row.branch_id) && row.stock <= row.min_stock && ctx.repos.products.byId(row.product_id)?.active !== false)
        .sort((a, b) => a.stock - b.stock);
      setHtml(
        lowCard,
        html`
          <div class="card-head">
            <h2>Por agotarse</h2>
            ${lowStock.length ? html`<span class="count-badge" data-tone="coral">${lowStock.length}</span>` : html``}
          </div>
          ${lowStock.length
            ? html`<div class="compact-list">
                ${lowStock.slice(0, 6).map((row) => {
                  const product = ctx.repos.products.byId(row.product_id);
                  const out = row.stock <= 0;
                  return html`
                    <div class="compact-item">
                      <div><strong>${product?.name ?? row.product_id}</strong>
                        <small class="muted">Mín. ${fmtQty(row.min_stock)}${scope === VIEW_ALL ? ` · ${ctx.branches.name(row.branch_id)}` : ""}</small></div>
                      <span class="stock-pill" data-tone="${out ? "coral" : "amber"}">${out ? "Agotado" : `${fmtQty(row.stock)} ${product?.um ?? "Pza"}`}</span>
                    </div>
                  `;
                })}
              </div>
              <button class="ghost block section-gap" type="button" data-go="inventario">Ver inventario${lowStock.length > 6 ? ` (${lowStock.length - 6} más)` : ""}</button>`
            : html`<p class="empty-note">Todo con existencia suficiente.</p>`}
        `
      );
    };

    // ---------------- Fiado ----------------

    const renderCredit = (scope: string): void => {
      const owing = ctx.repos.customers
        .list()
        .filter((c) => inScope(scope, c.branch_id) && c.balance > 0)
        .sort((a, b) => b.balance - a.balance);
      const total = sumCents(owing.map((c) => toCents(c.balance)));
      const max = Math.max(...owing.map((c) => c.balance), 1);
      setHtml(
        creditCard,
        html`
          <div class="card-head">
            <div><h2>Fiado pendiente</h2><p class="hint">${owing.length ? `${owing.length} ${owing.length === 1 ? "cliente debe" : "clientes deben"}` : "Nadie debe"}</p></div>
            <strong class="big-num" style="color:var(--c-amber)">${fmtMoney(total)}</strong>
          </div>
          ${owing.length
            ? html`<div class="bar-list">${owing.slice(0, 5).map((c) => barRow("amber", c.name, fmtMoneyPesos(c.balance), c.balance / max))}</div>
                <button class="ghost block section-gap" type="button" data-go="fiado">Ir a Fiado</button>`
            : html`<p class="empty-note">Sin cuentas pendientes.</p>`}
        `
      );
    };

    // ---------------- Vendedor ----------------

    const renderVendorPayments = (scope: string, today: PeriodReport): void => {
      const range = dayRange(todayInputValue());
      const byPayment = new Map<string, number>();
      for (const sale of ctx.repos.sales.list()) {
        if (sale.branch_id !== scope || sale.created_at < range.start || sale.created_at >= range.end || !isRevenueSale(sale)) continue;
        byPayment.set(sale.payment, (byPayment.get(sale.payment) ?? 0) + toCents(sale.total));
      }
      const totalCents = toCents(today.sales_total);
      const rows = [...byPayment.entries()].sort((a, b) => b[1] - a[1]);
      setHtml(
        goalsCard,
        html`
          <div class="card-head"><h2>Cobros de hoy</h2></div>
          ${rows.length
            ? html`<div class="bar-list">${rows.map(([payment, cents]) =>
                barRow(PAYMENT_TONES[payment] ?? "blue", PAYMENT_LABELS[payment as PaymentMethod] ?? payment, fmtMoney(cents), totalCents ? cents / totalCents : 0)
              )}</div>`
            : html`<p class="empty-note">Aún no hay ventas registradas hoy.</p>`}
        `
      );
    };

    const render = (): void => {
      const scope = ctx.branches.viewScope();
      const isManager = ctx.auth.isAdmin();
      renderGreeting(isManager, ctx.auth.isOwner());
      managerOnly.forEach((card) => card.classList.toggle("hidden", !isManager));
      root.querySelector("#goCorte")?.classList.toggle("hidden", !isManager);
      setHtml(
        scopeChips,
        isManager && ctx.branches.canSwitch()
          ? html`<div class="chips">${[...ctx.branches.list().map((b) => ({ id: b.id, label: b.name })), { id: VIEW_ALL, label: "Todas" }].map(
              (chip) => html`<button class="chip ${scope === chip.id ? "chip-active" : ""}" type="button" data-scope="${chip.id}">${chip.label}</button>`
            )}</div>`
          : html``
      );

      const today = dayReport(scope, 0);
      renderHero(scope, today, isManager);
      if (!isManager) {
        renderVendorPayments(scope, today);
        return;
      }
      const monthReport = ctx.reports.monthReport(scope, monthInputValue());
      renderGoals(scope, today, monthReport);
      renderWeek(scope, monthReport);
      renderMonth(scope, monthReport);
      renderRank(scope);
      renderLow(scope);
      renderCredit(scope);
    };

    const schedule = lazyRender(root, render);

    rankPeriodEl.addEventListener("click", (event) => {
      const chip = (event.target as HTMLElement).closest<HTMLElement>("[data-rank]");
      if (!chip) return;
      rankPeriod = (chip.dataset.rank as RankPeriod) ?? "day";
      rankPeriodEl.querySelectorAll<HTMLElement>(".chip").forEach((c) => c.classList.toggle("chip-active", c.dataset.rank === rankPeriod));
      renderRank(ctx.branches.viewScope());
    });

    scopeChips.addEventListener("click", (event) => {
      const chip = (event.target as HTMLElement).closest<HTMLElement>("[data-scope]");
      if (!chip) return;
      ctx.branches.setViewScope(chip.dataset.scope ?? VIEW_ALL);
    });

    // Las gráficas por hora cambian con el reloj: se redibuja cada 5 minutos
    window.setInterval(schedule, 5 * 60_000);

    ctx.store.watch(
      (s) => [s.sales, s.expenses, s.purchases, s.products, s.product_stocks, s.customers, s.shifts, s.branches, s.viewBranchId, s.settings] as const,
      schedule
    );
  }
};

