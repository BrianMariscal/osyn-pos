import { html, setHtml, type SafeHtml } from "../../core/html";
import { dayRange, monthInputValue, todayInputValue, toInputDateValue } from "../../core/dates";
import { fmtMoney, fmtMoneyPesos, sumCents, toCents, toPesos } from "../../core/money";
import { PAYMENT_LABELS, type PaymentMethod, type PeriodReport } from "../../core/types";
import { daysInMonth } from "../../domain/expense-service";
import { isRevenueSale } from "../../domain/sale-groups";
import { fmtQty } from "../../core/qty";
import { VIEW_ALL } from "../../domain/app-state";
import { iconFor } from "../icons";
import { lazyRender } from "../lazy-render";
import type { TabModule } from "./tab-module";

type RankPeriod = "day" | "week" | "month";
type Tone = "blue" | "teal" | "green" | "amber" | "coral" | "violet";

/** $1,234 → "$1.2k" para etiquetas de la gráfica. */
function fmtCompact(pesos: number): string {
  if (Math.abs(pesos) >= 1000) return `$${(pesos / 1000).toFixed(pesos >= 10000 ? 0 : 1)}k`;
  return `$${Math.round(pesos)}`;
}

function kpi(tone: Tone, icon: SafeHtml, label: string, value: string, foot: SafeHtml | string = ""): SafeHtml {
  return html`
    <div class="kpi" data-tone="${tone}">
      <div class="kpi-top"><span class="kpi-ico">${icon}</span><span class="kpi-label">${label}</span></div>
      <strong class="kpi-value">${value}</strong>
      ${foot ? html`<span class="kpi-foot">${foot}</span>` : html``}
    </div>
  `;
}

/** Comparación contra ayer: ▲ 12 % / ▼ 5 % / "Ayer $0.00". */
function deltaVsYesterday(today: number, yesterday: number): SafeHtml {
  if (yesterday <= 0) return html`<span class="delta">Ayer ${fmtMoneyPesos(yesterday)}</span>`;
  const pct = Math.round(((today - yesterday) / yesterday) * 100);
  const dir = pct > 0 ? "up" : pct < 0 ? "down" : "flat";
  return html`<span class="delta delta-${dir}">${pct > 0 ? "▲" : pct < 0 ? "▼" : "="} ${Math.abs(pct)}%</span> vs ayer`;
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
          <div id="scopeChips"></div>
        </header>
        <div class="kpi-grid" id="kpis"></div>
        <div class="dash-row dash-row-2">
          <article class="card chart-card" id="dCardChart"></article>
          <article class="card" id="dCardTarget">
            <h2>Meta del día</h2>
            <div id="dailyTarget"></div>
          </article>
        </div>
        <div class="dash-row dash-row-3" id="dRow3">
          <article class="card" id="dCardMonth"></article>
          <article class="card" id="dCardRank">
            <div class="card-head card-head-stack">
              <h2>Lo más vendido</h2>
              <div class="chips" id="rankPeriod">
                <button class="chip chip-active" type="button" data-rank="day">Hoy</button>
                <button class="chip" type="button" data-rank="week">Semana</button>
                <button class="chip" type="button" data-rank="month">Mes</button>
              </div>
            </div>
            <div id="rankBody"></div>
          </article>
          <article class="card" id="dCardLow"></article>
        </div>
      `
    );

    const scopeChips = root.querySelector<HTMLElement>("#scopeChips")!;
    const greetingEl = root.querySelector<HTMLElement>("#greeting")!;
    const kpisEl = root.querySelector<HTMLElement>("#kpis")!;
    const chartCard = root.querySelector<HTMLElement>("#dCardChart")!;
    const targetCard = root.querySelector<HTMLElement>("#dCardTarget")!;
    const targetEl = root.querySelector<HTMLElement>("#dailyTarget")!;
    const row3 = root.querySelector<HTMLElement>("#dRow3")!;
    const monthCard = root.querySelector<HTMLElement>("#dCardMonth")!;
    const lowCard = root.querySelector<HTMLElement>("#dCardLow")!;
    const rankBodyEl = root.querySelector<HTMLElement>("#rankBody")!;
    const rankPeriodEl = root.querySelector<HTMLElement>("#rankPeriod")!;

    let rankPeriod: RankPeriod = "day";

    const dayReport = (scope: string, offsetDays: number): PeriodReport => {
      const day = new Date();
      day.setDate(day.getDate() - offsetDays);
      const range = dayRange(toInputDateValue(day));
      return ctx.reports.periodReport(scope, range.start, range.end);
    };

    const renderGreeting = (isManager: boolean, isOwner: boolean): void => {
      const hour = new Date().getHours();
      const saludo = hour < 12 ? "Buenos días" : hour < 19 ? "Buenas tardes" : "Buenas noches";
      const firstName = ctx.auth.displayName();
      const date = new Date().toLocaleDateString("es-MX", { weekday: "long", day: "numeric", month: "long" });
      const sub = isOwner ? "Resumen de tu negocio" : isManager ? "Operación de la sucursal" : "Tus ventas de hoy";
      setHtml(
        greetingEl,
        html`<h2>${saludo}${firstName ? `, ${firstName}` : ""}</h2><p class="hint dash-date">${date} · ${sub}</p>`
      );
    };

    const renderVendor = (scope: string, today: PeriodReport, yesterday: PeriodReport): void => {
      const range = dayRange(todayInputValue());
      const byPayment = new Map<string, number>();
      for (const sale of ctx.repos.sales.list()) {
        if (sale.branch_id !== scope || sale.created_at < range.start || sale.created_at >= range.end || !isRevenueSale(sale)) continue;
        byPayment.set(sale.payment, (byPayment.get(sale.payment) ?? 0) + toCents(sale.total));
      }
      const totalCents = toCents(today.sales_total);
      const avg = today.sales_count ? today.sales_total / today.sales_count : 0;
      setHtml(
        kpisEl,
        html`
          ${kpi("blue", iconFor("cart"), "Ventas de hoy", fmtMoneyPesos(today.sales_total), deltaVsYesterday(today.sales_total, yesterday.sales_total))}
          ${kpi("violet", iconFor("receipt"), "Ventas realizadas", String(today.sales_count))}
          ${kpi("teal", iconFor("wallet"), "Ticket promedio", fmtMoneyPesos(avg))}
        `
      );
      const rows = [...byPayment.entries()].sort((a, b) => b[1] - a[1]);
      setHtml(
        chartCard,
        html`
          <div class="card-head"><h2>Cobros de hoy</h2></div>
          ${rows.length
            ? html`<div class="bar-list">${rows.map(([payment, cents]) =>
                barRow(PAYMENT_TONES[payment] ?? "blue", PAYMENT_LABELS[payment as PaymentMethod] ?? payment, fmtMoney(cents), totalCents ? cents / totalCents : 0)
              )}</div>`
            : html`<p class="empty-note">Aún no hay ventas registradas hoy.</p>`}
          <button class="primary block section-gap" type="button" data-go="venta">${iconFor("cart")} Nueva venta</button>
        `
      );
    };

    const barRow = (tone: Tone, label: string, value: string, ratio: number, sub = ""): SafeHtml => html`
      <div class="bar-row" data-tone="${tone}">
        <div class="bar-row-head"><span>${label}${sub ? html` <small class="muted">${sub}</small>` : html``}</span><strong>${value}</strong></div>
        <div class="bar-track"><div class="bar-fill" style="width:${Math.max(2, Math.round(Math.min(1, ratio) * 100))}%"></div></div>
      </div>
    `;

    const render = (): void => {
      const scope = ctx.branches.viewScope();
      const isManager = ctx.auth.isAdmin();
      renderGreeting(isManager, ctx.auth.isOwner());

      const today = dayReport(scope, 0);
      const yesterday = dayReport(scope, 1);

      targetCard.classList.toggle("hidden", !isManager);
      row3.classList.toggle("hidden", !isManager);
      if (!isManager) {
        setHtml(scopeChips, html``);
        renderVendor(scope, today, yesterday);
        return;
      }

      setHtml(
        scopeChips,
        ctx.branches.canSwitch()
          ? html`<div class="chips">${[...ctx.branches.list().map((b) => ({ id: b.id, label: b.name })), { id: VIEW_ALL, label: "Consolidado" }].map(
              (chip) => html`<button class="chip ${scope === chip.id ? "chip-active" : ""}" type="button" data-scope="${chip.id}">${chip.label}</button>`
            )}</div>`
          : html``
      );

      const stocks = ctx.repos.stocks.list().filter((row) => scope === VIEW_ALL || row.branch_id === scope);
      const lowStock = stocks
        .filter((row) => row.stock <= row.min_stock && ctx.repos.products.byId(row.product_id)?.active !== false)
        .sort((a, b) => a.stock - b.stock);
      const owing = ctx.repos.customers.list().filter((c) => (scope === VIEW_ALL || c.branch_id === scope) && c.balance > 0);
      const creditCents = sumCents(owing.map((c) => toCents(c.balance)));
      const monthReport = ctx.reports.monthReport(scope, monthInputValue());

      const days = Array.from({ length: 7 }, (_, i) => {
        const offset = 6 - i;
        const date = new Date();
        date.setDate(date.getDate() - offset);
        const report = offset === 0 ? today : offset === 1 ? yesterday : dayReport(scope, offset);
        return {
          weekday: date.toLocaleDateString("es-MX", { weekday: "short" }).replace(".", ""),
          day: date.getDate(),
          pesos: report.sales_total,
          count: report.sales_count
        };
      });
      const weekPesos = toPesos(sumCents(days.map((d) => toCents(d.pesos))));
      const maxPesos = Math.max(...days.map((d) => d.pesos), 1);
      const avgTicket = today.sales_count ? today.sales_total / today.sales_count : 0;

      setHtml(
        kpisEl,
        html`
          ${kpi("blue", iconFor("cart"), "Ventas de hoy", fmtMoneyPesos(today.sales_total), deltaVsYesterday(today.sales_total, yesterday.sales_total))}
          ${kpi("green", iconFor("chart"), "Ganancia neta hoy", fmtMoneyPesos(today.profit_after_expenses), today.sales_total > 0 ? `Margen bruto ${Math.round((today.gross_profit / today.sales_total) * 100)}%` : "Después de gastos")}
          ${kpi("violet", iconFor("receipt"), "Ventas realizadas", String(today.sales_count), `Ticket promedio ${fmtMoneyPesos(avgTicket)}`)}
          ${kpi("amber", iconFor("wallet"), "Fiado pendiente", fmtMoneyPesos(toPesos(creditCents)), owing.length ? `${owing.length} ${owing.length === 1 ? "cliente" : "clientes"}` : "Nadie debe")}
        `
      );

      const lastShift = ctx.shifts.lastShift(ctx.branches.operationalId());
      setHtml(
        chartCard,
        html`
          <div class="card-head">
            <div><h2>Ventas de la semana</h2><p class="hint">Últimos 7 días</p></div>
            <div class="align-right"><span class="micro">Total</span><strong class="big-num">${fmtMoneyPesos(weekPesos)}</strong></div>
          </div>
          <div class="chart" role="img" aria-label="Ventas de los últimos 7 días">
            ${days.map(
              (day, index) => html`
                <div class="chart-col ${index === days.length - 1 ? "today" : ""}" title="${day.weekday} ${day.day}: ${fmtMoneyPesos(day.pesos)} · ${day.count} ventas">
                  <span class="chart-val">${day.pesos > 0 ? fmtCompact(day.pesos) : ""}</span>
                  <div class="chart-bar" style="height:${Math.max(3, Math.round((day.pesos / maxPesos) * 100))}%"></div>
                  <span class="chart-label">${index === days.length - 1 ? "Hoy" : day.weekday}</span>
                </div>
              `
            )}
          </div>
          <div class="mini-stats">
            <div data-tone="blue"><span>Mes</span><strong>${fmtMoneyPesos(monthReport.sales_total)}</strong></div>
            <div data-tone="coral"><span>Gastos extra hoy</span><strong>${fmtMoneyPesos(today.extra_expenses_total ?? today.expenses_total)}</strong></div>
            <div data-tone="teal"><span>Base siguiente turno</span><strong>${fmtMoneyPesos(lastShift?.next_opening_cash ?? 0)}</strong></div>
          </div>
        `
      );

      renderMonth(scope, monthReport);
      renderLow(scope, lowStock);
      renderTarget(scope, today.gross_profit, today.sales_total, monthReport.sales_total, monthReport.gross_profit);
      renderRank(scope);
    };

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
            <div><h2>Este mes</h2><p class="hint">${scope === VIEW_ALL ? "Consolidado de tus sucursales" : ctx.branches.name(scope)}</p></div>
          </div>
          <div class="month-total"><span class="micro">Ventas</span><strong class="big-num">${fmtMoneyPesos(month.sales_total)}</strong></div>
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

    const renderLow = (scope: string, lowStock: ReturnType<typeof ctx.repos.stocks.list>): void => {
      setHtml(
        lowCard,
        html`
          <div class="card-head">
            <h2>Por agotarse</h2>
            ${lowStock.length ? html`<span class="count-badge" data-tone="coral">${lowStock.length}</span>` : html``}
          </div>
          ${lowStock.length
            ? html`<div class="compact-list">
                ${lowStock.slice(0, 8).map((row) => {
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
              <button class="ghost block section-gap" type="button" data-go="inventario">Ver inventario${lowStock.length > 8 ? ` (${lowStock.length - 8} más)` : ""}</button>`
            : html`<p class="empty-note">Todo con existencia suficiente.</p>`}
        `
      );
    };

    /**
     * Meta diaria: costos fijos del mes ÷ días del mes. Se cubre con GANANCIA
     * (venta − costo); con el margen del mes se estima cuánto vender.
     */
    const targetBreakdown = (scope: string): string => {
      const parts = ctx.expenses.fixedBreakdown(scope);
      return [
        parts.monthly > 0 ? `Mensuales ${fmtMoney(parts.monthly)} ÷ ${daysInMonth(new Date())} días` : "",
        parts.weekly > 0 ? `Semanales ${fmtMoney(parts.weekly)} ÷ 7 días` : ""
      ].filter(Boolean).join(" + ");
    };

    const renderTarget = (scope: string, grossToday: number, salesToday: number, salesMonth: number, grossMonth: number): void => {
      const monthly = ctx.expenses.monthlyFixedCents(scope);
      if (monthly <= 0) {
        setHtml(
          targetEl,
          html`<p class="hint">Registra tus costos fijos semanales y mensuales (renta, luz, sueldos) en Gastos y aquí verás cuánto necesitas generar cada día.</p>
            <button class="ghost block" type="button" data-go="gastos">Registrar costos fijos</button>`
        );
        return;
      }
      const target = ctx.expenses.dailyTargetCents(scope);
      const earned = toCents(grossToday);
      const progress = Math.max(0, Math.min(100, Math.round((earned / target) * 100)));
      const missing = Math.max(0, target - earned);
      // Margen bruto del mes (o de hoy si aún no hay datos del mes)
      const marginBase = salesMonth > 0 ? grossMonth / salesMonth : salesToday > 0 ? grossToday / salesToday : 0;
      const salesNeeded = marginBase > 0 ? Math.round(target / marginBase) : 0;
      setHtml(
        targetEl,
        html`
          <div class="target-ring ${progress >= 100 ? "done" : ""}" style="--p:${progress}" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${progress}" aria-label="Avance de la meta del día">
            <div class="target-ring-inner"><strong>${progress}%</strong><span class="micro">de la meta</span></div>
          </div>
          <div class="target-head">
            <div><span class="micro">Meta de ganancia</span><strong>${fmtMoney(target)}</strong></div>
            <div class="align-right"><span class="micro">Llevas hoy</span><strong>${fmtMoney(earned)}</strong></div>
          </div>
          <p class="hint">
            ${missing > 0 ? `Faltan ${fmtMoney(missing)} de ganancia para cubrir los costos fijos de hoy.` : "¡Meta del día cubierta!"}
            ${salesNeeded > 0 ? ` Con tu margen (${Math.round(marginBase * 100)}%) equivale a vender ≈ ${fmtMoney(salesNeeded)} al día.` : ""}
          </p>
          <p class="micro">${targetBreakdown(scope)}</p>
        `
      );
    };

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

    ctx.store.watch(
      (s) => [s.sales, s.expenses, s.purchases, s.products, s.product_stocks, s.customers, s.shifts, s.branches, s.viewBranchId, s.settings] as const,
      schedule
    );
  }
};
