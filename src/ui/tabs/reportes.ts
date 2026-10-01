import { html, setHtml } from "../../core/html";
import { dayRange, fmtDateTime, monthInputValue, todayInputValue } from "../../core/dates";
import { fmtMoneyPesos } from "../../core/money";
import { VIEW_ALL } from "../../domain/app-state";
import { confirmDialog } from "../components/modal";
import { openReportPdf } from "../pdf";
import type { TabModule } from "./tab-module";

export const reportesTab: TabModule = {
  id: "reportes",
  render(root, ctx) {
    setHtml(
      root,
      html`
        <div class="split">
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

    const dateInput = root.querySelector<HTMLInputElement>("#reportDate")!;
    const monthInput = root.querySelector<HTMLInputElement>("#monthClose")!;
    const scopeChips = root.querySelector<HTMLElement>("#reportScopeChips")!;
    const dailyEl = root.querySelector<HTMLElement>("#dailyReportSummary")!;
    const monthEl = root.querySelector<HTMLElement>("#monthReportSummary")!;
    const closingsEl = root.querySelector<HTMLElement>("#monthClosingsList")!;

    const currentScope = (): string => ctx.branches.viewScope();

    const renderChips = (): void => {
      if (!ctx.auth.isAdmin() || !ctx.branches.isMultiBranch()) {
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
        <div><span>Ventas</span><strong>${fmtMoneyPesos(report.sales_total)}</strong></div>
        <div><span>Costo vendido</span><strong>${fmtMoneyPesos(report.sales_cost)}</strong></div>
        <div><span>Ganancia bruta</span><strong>${fmtMoneyPesos(report.gross_profit)}</strong></div>
        <div><span>Gastos</span><strong>${fmtMoneyPesos(report.expenses_total)}</strong></div>
        <div><span>Compras proveedores</span><strong>${fmtMoneyPesos(report.purchases_total)}</strong></div>
        <div><span>Mermas</span><strong>${fmtMoneyPesos(report.mermas_total)}</strong></div>
        <div><span>Ganancia después de gastos</span><strong>${fmtMoneyPesos(report.profit_after_expenses)}</strong></div>
        <div><span>Fiado vendido</span><strong>${fmtMoneyPesos(report.credit_total)}</strong></div>
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
      const now = new Date().toISOString();
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
      (s) => [s.sales, s.expenses, s.purchases, s.month_closings, s.branches, s.viewBranchId] as const,
      render
    );
    render();
  }
};
