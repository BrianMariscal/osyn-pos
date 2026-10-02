import { html, setHtml } from "../../core/html";
import { dayRange, monthInputValue, todayInputValue, toInputDateValue } from "../../core/dates";
import { fmtMoney, fmtMoneyPesos, sumCents, toCents, toPesos } from "../../core/money";
import { PAYMENT_LABELS } from "../../core/types";
import { daysInMonth } from "../../domain/expense-service";
import { isRevenueSale } from "../../domain/sale-groups";
import { fmtQty } from "../../core/qty";
import { VIEW_ALL } from "../../domain/app-state";
import type { TabModule } from "./tab-module";

type RankPeriod = "day" | "week" | "month";

export const inicioTab: TabModule = {
  id: "inicio",
  render(root, ctx) {
    setHtml(
      root,
      html`
        <div class="greeting" id="greeting"></div>
        <div class="dashboard-grid">
          <article class="card" id="dCardMain">
            <div class="scope-chips" id="scopeChips"></div>
            <div id="dashboardSummary" class="stack-metrics"></div>
          </article>
          <article class="card" id="dCardTarget">
            <h2>Meta del día</h2>
            <div id="dailyTarget"></div>
          </article>
          <article class="card" id="dCardMonth">
            <h2>Este mes</h2>
            <p class="hint" id="monthScope"></p>
            <div class="summary" id="monthSummary"></div>
          </article>
          <article class="card" id="dCardLow">
            <h2>Por agotarse</h2>
            <div id="dashboardLowStock" class="list"></div>
          </article>
          <article class="card" id="dCardRank">
            <h2>Lo más vendido… y lo que no sale</h2>
            <div class="chips" id="rankPeriod">
              <button class="chip chip-active" type="button" data-rank="day">Hoy</button>
              <button class="chip" type="button" data-rank="week">Semana</button>
              <button class="chip" type="button" data-rank="month">Mes</button>
            </div>
            <div id="rankBody"></div>
          </article>
        </div>
      `
    );

    const scopeChips = root.querySelector<HTMLElement>("#scopeChips")!;
    const greetingEl = root.querySelector<HTMLElement>("#greeting")!;
    const summaryEl = root.querySelector<HTMLElement>("#dashboardSummary")!;
    const monthScopeEl = root.querySelector<HTMLElement>("#monthScope")!;
    const monthSummaryEl = root.querySelector<HTMLElement>("#monthSummary")!;
    const lowStockEl = root.querySelector<HTMLElement>("#dashboardLowStock")!;
    const rankBodyEl = root.querySelector<HTMLElement>("#rankBody")!;
    const rankPeriodEl = root.querySelector<HTMLElement>("#rankPeriod")!;
    const dCardMonth = root.querySelector<HTMLElement>("#dCardMonth")!;
    const dCardTarget = root.querySelector<HTMLElement>("#dCardTarget")!;
    const targetEl = root.querySelector<HTMLElement>("#dailyTarget")!;
    const dCardLow = root.querySelector<HTMLElement>("#dCardLow")!;
    const dCardRank = root.querySelector<HTMLElement>("#dCardRank")!;

    let rankPeriod: RankPeriod = "day";
    let renderRankBody: (scope: string) => void = () => undefined;

    const render = (): void => {
      const scope = ctx.branches.viewScope();
      const isManager = ctx.auth.isAdmin();
      const isOwner = ctx.auth.isOwner();

      // Saludo según la hora y el rol
      const hour = new Date().getHours();
      const saludo = hour < 12 ? "Buenos días" : hour < 19 ? "Buenas tardes" : "Buenas noches";
      const firstName = ctx.auth.displayName();
      const sub = isOwner
        ? "Resumen global de tu negocio."
        : isManager
          ? "Operación de la sucursal activa."
          : "Tus ventas de hoy en esta caja.";
      setHtml(
        greetingEl,
        html`
          <h2>${saludo}${firstName ? `, ${firstName}` : ""}</h2>
          <p class="hint">${sub}</p>
        `
      );

      const today = dayRange(todayInputValue());
      const report = ctx.reports.periodReport(scope, today.start, today.end);

      // ---- VENDEDOR: solo la venta del día ----
      if (!isManager) {
        dCardMonth.classList.add("hidden");
        dCardTarget.classList.add("hidden");
        dCardLow.classList.add("hidden");
        dCardRank.classList.add("hidden");
        setHtml(scopeChips, html``);
        const byPayment: Array<{ label: string; cents: number }> = [];
        for (const sale of ctx.repos.sales.list()) {
          if (sale.branch_id !== scope || sale.created_at < today.start || sale.created_at >= today.end || !isRevenueSale(sale)) continue;
          const row = byPayment.find((item) => item.label === sale.payment);
          if (row) row.cents += toCents(sale.total);
          else byPayment.push({ label: sale.payment, cents: toCents(sale.total) });
        }
        setHtml(
          summaryEl,
          html`
            <div class="hero-metrics">
              <div class="metric metric-hero">
                <span class="micro">Ventas de hoy</span>
                <strong>${fmtMoneyPesos(report.sales_total)}</strong>
              </div>
              <div class="metric metric-hero">
                <span class="micro">Ventas realizadas</span>
                <strong>${report.sales_count}</strong>
              </div>
            </div>
            ${byPayment.length
              ? html`<div class="summary">
                  ${byPayment.map((row) => html`<div><span>${PAYMENT_LABELS[row.label as keyof typeof PAYMENT_LABELS] ?? row.label}</span><strong>${fmtMoneyPesos(toPesos(row.cents))}</strong></div>`)}
                </div>`
              : html`<p class="hint">Aún no hay ventas registradas hoy.</p>`}
            <button class="primary block" type="button" data-go="venta">Nueva venta</button>
          `
        );
        return;
      }

      // ---- DUEÑO / ADMINISTRADOR: resumen completo con hoy, semana y mes ----
      dCardMonth.classList.remove("hidden");
      dCardTarget.classList.remove("hidden");
      dCardLow.classList.remove("hidden");
      dCardRank.classList.remove("hidden");

      if (isManager && ctx.branches.isMultiBranch()) {
        const chips = [
          ...ctx.branches.list().map((b) => ({ id: b.id, label: b.name })),
          { id: VIEW_ALL, label: "Consolidado" }
        ];
        setHtml(
          scopeChips,
          html`<div class="chips">${chips.map(
            (chip) =>
              html`<button class="chip ${scope === chip.id ? "chip-active" : ""}" type="button" data-scope="${chip.id}">${chip.label}</button>`
          )}</div>`
        );
      } else {
        setHtml(scopeChips, html``);
      }

      const stocks = ctx.repos.stocks.list().filter((row) => scope === VIEW_ALL || row.branch_id === scope);
      const lowStock = stocks.filter((row) => row.stock <= row.min_stock).sort((a, b) => a.stock - b.stock);
      const scopeCustomers = ctx.repos.customers.list().filter((c) => scope === VIEW_ALL || c.branch_id === scope);
      const creditCents = sumCents(scopeCustomers.map((c) => toCents(c.balance)));
      const lastShift = ctx.shifts.lastShift(ctx.branches.operationalId());

      // Tendencia de los últimos 7 días
      const days: Array<{ label: string; cents: number }> = [];
      for (let i = 6; i >= 0; i -= 1) {
        const day = new Date();
        day.setDate(day.getDate() - i);
        const range = dayRange(toInputDateValue(day));
        const dayReport = ctx.reports.periodReport(scope, range.start, range.end);
        days.push({ label: day.toLocaleDateString("es-MX", { weekday: "narrow" }), cents: toCents(dayReport.sales_total) });
      }
      const maxCents = Math.max(...days.map((d) => d.cents), 1);
      const weekCents = sumCents(days.map((d) => d.cents));
      const monthReport = ctx.reports.monthReport(scope, monthInputValue());

      setHtml(
        summaryEl,
        html`
          <div class="hero-metrics">
            <div class="metric metric-hero">
              <span class="micro">Ganancia neta hoy</span>
              <strong>${fmtMoneyPesos(report.profit_after_expenses)}</strong>
            </div>
            <div class="metric metric-hero">
              <span class="micro">Fiado pendiente</span>
              <strong>${fmtMoneyPesos(toPesos(creditCents))}</strong>
            </div>
          </div>
          <div class="period-strip">
            <div class="period-cell"><span class="micro">Hoy</span><strong>${fmtMoneyPesos(report.sales_total)}</strong></div>
            <div class="period-cell"><span class="micro">Semana</span><strong>${fmtMoneyPesos(toPesos(weekCents))}</strong></div>
            <div class="period-cell"><span class="micro">Mes</span><strong>${fmtMoneyPesos(monthReport.sales_total)}</strong></div>
          </div>
          <div class="metric-grid-4">
            <div class="metric"><span>Ventas de hoy</span><strong>${report.sales_count}</strong></div>
            <div class="metric"><span>Productos bajos</span><strong>${lowStock.length}</strong></div>
            <div class="metric"><span>Gastos extra hoy</span><strong>${fmtMoneyPesos(report.extra_expenses_total ?? report.expenses_total)}</strong></div>
            <div class="metric"><span>Base siguiente</span><strong>${fmtMoneyPesos(lastShift?.next_opening_cash ?? 0)}</strong></div>
          </div>
          <div class="chart-title micro">Ventas últimos 7 días</div>
          <div class="chart" role="img" aria-label="Ventas de los últimos 7 días">
            ${days.map(
              (day, index) => html`
                <div class="chart-col ${index === days.length - 1 ? "today" : ""}">
                  <div class="chart-bar" style="height:${Math.max(4, Math.round((day.cents / maxCents) * 100))}%"></div>
                  <span>${day.label}</span>
                </div>
              `
            )}
          </div>
        `
      );

      monthScopeEl.textContent = scope === VIEW_ALL ? "Consolidado de tus sucursales" : ctx.branches.name(scope);
      setHtml(
        monthSummaryEl,
        html`
          <div><span>Ventas</span><strong>${fmtMoneyPesos(monthReport.sales_total)}</strong></div>
          <div><span>Ganancia neta</span><strong>${fmtMoneyPesos(monthReport.profit_after_expenses)}</strong></div>
          <div><span>Costos fijos</span><strong>${fmtMoneyPesos(monthReport.fixed_costs_total ?? 0)}</strong></div>
          <div><span>Gastos extra</span><strong>${fmtMoneyPesos(monthReport.extra_expenses_total ?? monthReport.expenses_total)}</strong></div>
          <div><span>Compras a proveedores</span><strong>${fmtMoneyPesos(monthReport.purchases_total)}</strong></div>
        `
      );

      setHtml(
        lowStockEl,
        lowStock.length
          ? html`${lowStock.slice(0, 12).map((row) => {
              const product = ctx.repos.products.byId(row.product_id);
              const branchLabel = scope === VIEW_ALL ? ctx.branches.name(row.branch_id) : "";
              return html`
                <div class="list-item low">
                  <div class="item-line"><strong>${product?.name ?? row.product_id}</strong><strong>${fmtQty(row.stock)} ${product?.um ?? "Pza"}</strong></div>
                  <p class="muted">Mínimo ${fmtQty(row.min_stock)} ${product?.um ?? "Pza"} | ${product?.category || "Sin categoría"}${branchLabel ? ` | ${branchLabel}` : ""}</p>
                </div>
              `;
            })}`
          : html`<p class="muted">No hay productos por agotarse.</p>`
      );

      renderTarget(scope, report.gross_profit, report.sales_total, monthReport.sales_total, monthReport.gross_profit);
      renderRankBody(scope);
    };

    /**
     * Meta diaria: costos fijos del mes ÷ días del mes. Se cubre con GANANCIA
     * (venta − costo); con el margen del mes se estima cuánto vender.
     */
    const renderTarget = (scope: string, grossToday: number, salesToday: number, salesMonth: number, grossMonth: number): void => {
      const monthly = ctx.expenses.monthlyFixedCents(scope);
      if (monthly <= 0) {
        setHtml(
          targetEl,
          html`<p class="hint">Registra tus costos fijos mensuales (renta, luz, sueldos) en Gastos y aquí verás cuánto necesitas generar cada día.</p>
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
          <div class="target-head">
            <div><span class="micro">Necesitas generar al día</span><strong>${fmtMoney(target)}</strong></div>
            <div class="align-right"><span class="micro">Llevas hoy</span><strong>${fmtMoney(earned)}</strong></div>
          </div>
          <div class="progress" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${progress}" aria-label="Avance de la meta del día">
            <div class="progress-bar ${progress >= 100 ? "done" : ""}" style="width:${progress}%"></div>
          </div>
          <p class="hint">
            ${missing > 0 ? `Faltan ${fmtMoney(missing)} de ganancia para cubrir los costos fijos de hoy.` : "¡Meta del día cubierta!"}
            ${salesNeeded > 0 ? ` Con tu margen actual (${Math.round(marginBase * 100)}%) equivale a vender ≈ ${fmtMoney(salesNeeded)} al día.` : ""}
          </p>
          <p class="micro">Costos fijos: ${fmtMoney(monthly)} al mes ÷ ${daysInMonth(new Date())} días</p>
        `
      );
    };

    const renderRankBodyFor = (scope: string): void => {
      let report;
      if (rankPeriod === "week") {
        const start = new Date();
        start.setDate(start.getDate() - 6);
        report = ctx.reports.periodReport(scope, dayRange(toInputDateValue(start)).start, dayRange(todayInputValue()).end);
      } else if (rankPeriod === "month") {
        report = ctx.reports.monthReport(scope, monthInputValue());
      } else {
        const range = dayRange(todayInputValue());
        report = ctx.reports.periodReport(scope, range.start, range.end);
      }
      const top = report.top_products.slice(0, 5);
      const notSold = report.slow_products.filter((stat) => stat.qty === 0).slice(0, 8);
      const periodLabel = rankPeriod === "week" ? "esta semana" : rankPeriod === "month" ? "este mes" : "hoy";
      setHtml(
        rankBodyEl,
        html`
          ${top.length
            ? html`<div class="list">
                ${top.map(
                  (stat, index) => html`
                    <div class="list-item item-line">
                      <div><strong>${index + 1}. ${stat.name}</strong><p class="muted">${fmtQty(stat.qty)} ${stat.um} vendidos</p></div>
                      <strong>${fmtMoneyPesos(stat.total)}</strong>
                    </div>
                  `
                )}
              </div>`
            : html`<p class="muted">Aún no hay ventas ${periodLabel}.</p>`}
          <p class="micro section-gap">Sin ninguna venta</p>
          ${notSold.length
            ? html`<div class="chips chips-wrap">${notSold.map((stat) => html`<span class="chip chip-muted">${stat.name}</span>`)}</div>`
            : html`<p class="muted">Todo se movió: cada producto tuvo al menos una venta.</p>`}
        `
      );
    };

    renderRankBody = renderRankBodyFor;

    rankPeriodEl.addEventListener("click", (event) => {
      const chip = (event.target as HTMLElement).closest<HTMLElement>("[data-rank]");
      if (!chip) return;
      rankPeriod = (chip.dataset.rank as RankPeriod) ?? "day";
      rankPeriodEl.querySelectorAll<HTMLElement>(".chip").forEach((c) => c.classList.toggle("chip-active", c.dataset.rank === rankPeriod));
      renderRankBody(ctx.branches.viewScope());
    });

    scopeChips.addEventListener("click", (event) => {
      const chip = (event.target as HTMLElement).closest<HTMLElement>("[data-scope]");
      if (!chip) return;
      ctx.branches.setViewScope(chip.dataset.scope ?? VIEW_ALL);
    });

    ctx.store.watch(
      (s) => [s.sales, s.expenses, s.purchases, s.products, s.product_stocks, s.customers, s.shifts, s.branches, s.viewBranchId, s.settings] as const,
      render
    );
  }
};
