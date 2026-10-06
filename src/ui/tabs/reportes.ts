import { html, setHtml } from "../../core/html";
import { dayRange, fmtDateTime, monthInputValue, nowISO, todayInputValue, toInputDateValue } from "../../core/dates";
import { fmtMoney, fmtMoneyPesos, sumCents, toCents } from "../../core/money";
import { fmtQty } from "../../core/qty";
import { PAYMENT_LABELS, type PaymentMethod } from "../../core/types";
import { saleFolio } from "../../domain/ticket";
import { paginate, pagerClick, pagerMarkup } from "../pager";
import { openTicket } from "../ticket";
import { VIEW_ALL } from "../../domain/app-state";
import { confirmDialog } from "../components/modal";
import { openReportPdf } from "../pdf";
import { mountSections } from "../sections";
import type { TabModule } from "./tab-module";

export const reportesTab: TabModule = {
  id: "reportes",
  render(root, ctx) {
    setHtml(
      root,
      html`
        <div class="split">
          <article class="card span-all" id="salesDayCard">
            <div class="section-title">
              <h2>Ventas del día</h2>
              <div class="day-nav">
                <button class="icon-btn" type="button" data-day-shift="-1" aria-label="Día anterior">‹</button>
                <input id="salesDay" class="input" type="date" aria-label="Día">
                <button class="icon-btn" type="button" data-day-shift="1" aria-label="Día siguiente">›</button>
                <button class="ghost" type="button" data-day-today>Hoy</button>
              </div>
            </div>
            <div id="salesDaySummary" class="mini-stats"></div>
            <div id="salesDayList" class="list"></div>
          </article>
          <article class="card">
            <h2>Reportes y PDF</h2>
            <div id="reportScopeChips" class="chips chips-row"></div>
            <label class="form-field">Fecha del reporte diario
              <input id="reportDate" class="input" type="date">
            </label>
            <div id="dailyReportSummary" class="summary"></div>
            <div class="actions">
              <button id="downloadDailyPdf" class="primary" type="button">PDF del día</button>
              <button id="downloadAccumulatedPdf" class="ghost" type="button">PDF acumulado</button>
            </div>
          </article>
          <article class="card">
            <h2>Cierre mensual</h2>
            <label class="form-field">Mes
              <input id="monthClose" class="input" type="month">
            </label>
            <div id="monthReportSummary" class="summary"></div>
            <div class="actions">
              <button id="closeMonth" class="primary" type="button">Cerrar mes</button>
              <button id="downloadMonthPdf" class="ghost" type="button">PDF del mes</button>
            </div>
            <h2>Meses cerrados</h2>
            <div id="monthClosingsList" class="list"></div>
          </article>
        </div>
      `
    );

    // En celular: una sección a la vez (en computadora van lado a lado)
    const articles = [...root.querySelectorAll<HTMLElement>(":scope > .split > article")];
    mountSections(root, [
      { id: "ventas", label: "Ventas del día", el: articles[0] ?? null },
      { id: "reportes", label: "Reportes", el: articles[1] ?? null },
      { id: "cierre", label: "Cierre mensual", el: articles[2] ?? null }
    ]);

    // ---- Ventas del día: tickets de un día, con su resumen ----
    const salesDayInput = root.querySelector<HTMLInputElement>("#salesDay")!;
    const salesDaySummary = root.querySelector<HTMLElement>("#salesDaySummary")!;
    const salesDayList = root.querySelector<HTMLElement>("#salesDayList")!;
    salesDayInput.value = todayInputValue();
    let salesDayPage = 0;

    const daySales = () => {
      const scope = currentScope();
      const range = dayRange(salesDayInput.value || todayInputValue());
      return ctx.repos.sales
        .list()
        .filter((sale) => (scope === VIEW_ALL || sale.branch_id === scope) && sale.created_at >= range.start && sale.created_at < range.end)
        .sort((a, b) => b.created_at.localeCompare(a.created_at));
    };

    const renderSalesDay = (): void => {
      const sales = daySales();
      const revenue = sales.filter((sale) => sale.payment !== "interno");
      const byPayment = new Map<string, number>();
      for (const sale of revenue) byPayment.set(sale.payment, (byPayment.get(sale.payment) ?? 0) + toCents(sale.total));
      const totalCents = sumCents(revenue.map((sale) => toCents(sale.total)));
      const tones: Record<string, string> = { efectivo: "green", transferencia: "blue", tarjeta: "violet", fiado: "amber" };
      setHtml(
        salesDaySummary,
        html`
          <div data-tone="blue"><span>Total vendido</span><strong>${fmtMoney(totalCents)}</strong></div>
          <div data-tone="teal"><span>Tickets</span><strong>${revenue.length}</strong></div>
          ${[...byPayment.entries()].map(
            ([payment, cents]) => html`<div data-tone="${tones[payment] ?? "blue"}"><span>${PAYMENT_LABELS[payment as PaymentMethod] ?? payment}</span><strong>${fmtMoney(cents)}</strong></div>`
          )}
        `
      );
      if (!sales.length) {
        setHtml(salesDayList, html`<p class="empty-note">No hay ventas este día.</p>`);
        return;
      }
      const page = paginate(sales, salesDayPage, 10);
      setHtml(
        salesDayList,
        html`${page.items.map((sale) => {
          const pieces = sale.items.reduce((sum, item) => sum + (item.pack_size ? item.qty * item.pack_size : item.qty), 0);
          const names = sale.items.map((item) => item.name).join(", ");
          return html`
            <button class="ticket-row" type="button" data-ticket="${sale.id}">
              <span class="ticket-row-time">${new Date(sale.created_at).toLocaleTimeString("es-MX", { hour: "2-digit", minute: "2-digit" })}</span>
              <span class="row-title"><strong>${names}</strong><small class="muted">Folio ${saleFolio(sale)} · ${fmtQty(pieces)} art.${sale.cashier ? ` · ${sale.cashier}` : ""}</small></span>
              <span class="tag" data-tone="${tones[sale.payment] ?? "teal"}">${PAYMENT_LABELS[sale.payment]}</span>
              <strong class="row-price">${fmtMoneyPesos(sale.total)}</strong>
            </button>
          `;
        })}${pagerMarkup("salesDay", page)}`
      );
    };

    salesDayInput.addEventListener("change", () => {
      salesDayPage = 0;
      renderSalesDay();
    });
    root.querySelector<HTMLElement>("#salesDayCard")!.addEventListener("click", (event) => {
      const target = event.target as HTMLElement;
      const shift = target.closest<HTMLElement>("[data-day-shift]");
      if (shift || target.closest("[data-day-today]")) {
        const base = salesDayInput.value ? new Date(`${salesDayInput.value}T12:00:00`) : new Date();
        if (shift) base.setDate(base.getDate() + Number(shift.dataset.dayShift));
        salesDayInput.value = shift ? toInputDateValue(base) : todayInputValue();
        salesDayPage = 0;
        renderSalesDay();
        return;
      }
      const paging = pagerClick(event);
      if (paging) {
        salesDayPage = paging.page;
        renderSalesDay();
        return;
      }
      const row = target.closest<HTMLElement>("[data-ticket]");
      const sale = row && ctx.repos.sales.byId(row.dataset.ticket!);
      if (sale) openTicket(ctx, sale);
    });

    const dateInput = root.querySelector<HTMLInputElement>("#reportDate")!;
    const monthInput = root.querySelector<HTMLInputElement>("#monthClose")!;
    const scopeChips = root.querySelector<HTMLElement>("#reportScopeChips")!;
    const dailyEl = root.querySelector<HTMLElement>("#dailyReportSummary")!;
    const monthEl = root.querySelector<HTMLElement>("#monthReportSummary")!;
    const closingsEl = root.querySelector<HTMLElement>("#monthClosingsList")!;

    const currentScope = (): string => ctx.branches.viewScope();

    const renderChips = (): void => {
      if (!ctx.auth.isAdmin() || !ctx.branches.canSwitch()) {
        setHtml(scopeChips, html``);
        return;
      }
      const chips = [
        ...ctx.branches.list().map((branch) => ({ id: branch.id, label: branch.name })),
        { id: VIEW_ALL, label: "Consolidado" }
      ];
      const scope = currentScope();
      setHtml(
        scopeChips,
        html`${chips.map(
          (chip) => html`<button class="chip ${scope === chip.id ? "chip-active" : ""}" type="button" data-scope="${chip.id}">${chip.label}</button>`
        )}`
      );
    };

    const summaryRows = (report: ReturnType<typeof ctx.reports.periodReport>): ReturnType<typeof html> =>
      html`
        <div class="row-strong"><span>Ventas</span><strong>${fmtMoneyPesos(report.sales_total)}</strong></div>
        <div class="row-group"><span>Cigarros</span><strong>${fmtMoneyPesos(report.cigarros_total ?? 0)}</strong></div>
        <div class="row-group"><span>Cerveza</span><strong>${fmtMoneyPesos(report.cerveza_total ?? 0)}</strong></div>
        <div><span>Costo vendido</span><strong>${fmtMoneyPesos(report.sales_cost)}</strong></div>
        <div><span>Ganancia bruta</span><strong>${fmtMoneyPesos(report.gross_profit)}</strong></div>
        <div><span>Costos fijos (proporcional)</span><strong>${fmtMoneyPesos(report.fixed_costs_total ?? 0)}</strong></div>
        <div><span>Gastos extra</span><strong>${fmtMoneyPesos(report.extra_expenses_total ?? report.expenses_total)}</strong></div>
        <div><span>Compras proveedores</span><strong>${fmtMoneyPesos(report.purchases_total)}</strong></div>
        <div><span>Mermas</span><strong>${fmtMoneyPesos(report.mermas_total)}</strong></div>
        <div class="row-strong"><span>Ganancia después de gastos</span><strong>${fmtMoneyPesos(report.profit_after_expenses)}</strong></div>
        <div><span>Fiado vendido</span><strong>${fmtMoneyPesos(report.credit_total)}</strong></div>
        <div><span>Consumo interno (a costo)</span><strong>${fmtMoneyPesos(report.internal_total ?? 0)}</strong></div>
      `;

    const render = (): void => {
      renderChips();
      if (dateInput.value) {
        const range = dayRange(dateInput.value);
        setHtml(dailyEl, summaryRows(ctx.reports.periodReport(currentScope(), range.start, range.end)));
      }
      if (monthInput.value) {
        setHtml(monthEl, summaryRows(ctx.reports.monthReport(currentScope(), monthInput.value)));
      }
      const scope = currentScope();
      const closings = ctx.repos.closings
        .list()
        .filter((closing) => scope === VIEW_ALL || closing.branch_id === scope)
        .slice(0, 24);
      setHtml(
        closingsEl,
        closings.length
          ? html`${closings.map(
              (closing) => html`
                <div class="list-item">
                  <div class="item-line">
                    <strong>${closing.month}</strong>
                    <strong>${fmtMoneyPesos(closing.report?.profit_after_expenses ?? 0)}</strong>
                  </div>
                  <p class="muted">
                    Ventas ${fmtMoneyPesos(closing.report?.sales_total ?? 0)} | Gastos ${fmtMoneyPesos(closing.report?.expenses_total ?? 0)}
                    | ${ctx.branches.name(closing.branch_id)} | Cerrado ${fmtDateTime(closing.closed_at)}
                  </p>
                </div>
              `
            )}`
          : html`<p class="muted">Aún no hay meses cerrados.</p>`
      );
    };

    const initDates = (): void => {
      if (!dateInput.value) dateInput.value = todayInputValue();
      if (!monthInput.value) monthInput.value = monthInputValue();
    };

    dateInput.addEventListener("change", render);
    monthInput.addEventListener("change", render);
    scopeChips.addEventListener("click", (event) => {
      const chip = (event.target as HTMLElement).closest<HTMLElement>("[data-scope]");
      if (!chip) return;
      ctx.branches.setViewScope(chip.dataset.scope ?? VIEW_ALL);
    });

    root.querySelector<HTMLButtonElement>("#downloadDailyPdf")!.addEventListener("click", () => {
      const range = dayRange(dateInput.value);
      openReportPdf(`Reporte diario ${dateInput.value}`, ctx.store.getState().settings.storeName || "Mi tienda", ctx.reports.periodReport(currentScope(), range.start, range.end));
    });
    root.querySelector<HTMLButtonElement>("#downloadAccumulatedPdf")!.addEventListener("click", () => {
      openReportPdf("Reporte acumulado", ctx.store.getState().settings.storeName || "Mi tienda", ctx.reports.periodReport(currentScope(), "1970-01-01T00:00:00.000Z", new Date(Date.now() + 86400000).toISOString()));
    });
    root.querySelector<HTMLButtonElement>("#downloadMonthPdf")!.addEventListener("click", () => {
      openReportPdf(`Reporte mensual ${monthInput.value}`, ctx.store.getState().settings.storeName || "Mi tienda", ctx.reports.monthReport(currentScope(), monthInput.value));
    });
    root.querySelector<HTMLButtonElement>("#closeMonth")!.addEventListener("click", async () => {
      if (!ctx.auth.isAdmin()) {
        ctx.toast("Solo el administrador puede cerrar meses");
        return;
      }
      const month = monthInput.value;
      if (!month) {
        ctx.toast("Selecciona mes");
        return;
      }
      const existing = ctx.repos.closings.list().find((closing) => closing.month === month && closing.branch_id === currentScope());
      if (existing) {
        const replace = await confirmDialog({
          title: "Mes ya cerrado",
          message: `El mes ${month} ya está cerrado para este alcance. ¿Reemplazarlo?`,
          confirmLabel: "Reemplazar",
          keyword: "REEMPLAZAR"
        });
        if (!replace) return;
      }
      const confirmed = await confirmDialog({
        title: "Cerrar mes",
        message: `Se guardará el cierre de ${month} para ${currentScope() === VIEW_ALL ? "el consolidado" : ctx.branches.name(currentScope())}.`,
        confirmLabel: "Cerrar mes",
        keyword: "CERRAR MES"
      });
      if (!confirmed) return;
      const report = ctx.reports.monthReport(currentScope(), month);
      const now = nowISO();
      ctx.repos.closings.upsert({
        id: existing?.id ?? `${month}:${currentScope()}`,
        branch_id: currentScope(),
        month,
        report,
        closed_at: now,
        updated_at: now
      });
      ctx.toast(`Mes ${month} cerrado`);
      render();
    });

    // Gancho del asistente IA
    ctx.hooks.openReport = (period) => {
      if (period === "accumulated") {
        root.querySelector<HTMLButtonElement>("#downloadAccumulatedPdf")?.click();
      } else if (period === "month") {
        root.querySelector<HTMLButtonElement>("#downloadMonthPdf")?.click();
      } else {
        root.querySelector<HTMLButtonElement>("#downloadDailyPdf")?.click();
      }
    };

    initDates();
    ctx.store.watch(
      (s) => [s.sales, s.expenses, s.purchases, s.mermas, s.month_closings, s.branches, s.viewBranchId] as const,
      () => {
        render();
        renderSalesDay();
      }
    );
    render();
  }
};
