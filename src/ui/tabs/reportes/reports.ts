import { dayRange, fmtDateTime, monthInputValue, nowISO, todayInputValue } from "../../../core/dates";
import { html, setHtml } from "../../../core/html";
import { fmtMoneyPesos } from "../../../core/money";
import { VIEW_ALL } from "../../../domain/app-state";
import { confirmDialog } from "../../components/modal";
import { openReportPdf } from "../../pdf";
import { renderWeekReport } from "./week";
import type { ReportesScene } from "./scene";

/** Reportes diario/mensual con PDF, alcance por sucursal y cierre de mes. */
export function mountReports(scene: ReportesScene): { renderReports(): void } {
  const { ctx, root, ui, currentScope } = scene;
  const { dateInput, monthInput, scopeChips, dailyEl, monthEl, closingsEl, weekEl } = ui;

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

  const summaryRows = (report: ReturnType<typeof ctx.reports.periodReport>, period: "dia" | "mes" = "mes"): ReturnType<typeof html> =>
    html`
      <div class="row-strong"><span>Ventas</span><strong>${fmtMoneyPesos(report.sales_total)}</strong></div>
      <div class="row-group"><span>Cigarros</span><strong>${fmtMoneyPesos(report.cigarros_total ?? 0)}</strong></div>
      <div class="row-group"><span>Cerveza</span><strong>${fmtMoneyPesos(report.cerveza_total ?? 0)}</strong></div>
      <div><span>Costo de la mercancía</span><strong>${fmtMoneyPesos(report.sales_cost)}</strong></div>
      <div><span>Ganancia de la mercancía</span><strong>${fmtMoneyPesos(report.gross_profit)}</strong></div>
      <div><span>Gastos fijos del periodo</span><strong>${fmtMoneyPesos(report.fixed_costs_total ?? 0)}</strong></div>
      <div><span>Otros gastos</span><strong>${fmtMoneyPesos(report.extra_expenses_total ?? report.expenses_total)}</strong></div>
      <div><span>Compras de mercancía (inventario, no se resta)</span><strong>${fmtMoneyPesos(report.purchases_total)}</strong></div>
      <div><span>Mermas (pérdida, no restada)</span><strong>${fmtMoneyPesos(report.mermas_total)}</strong></div>
      <div><span>Devoluciones (ya restadas)</span><strong>${fmtMoneyPesos(report.returns_total ?? 0)}</strong></div>
      <div class="row-strong"><span>Lo que te queda libre</span><strong>${fmtMoneyPesos(report.profit_after_expenses)}</strong></div>
      <div><span>Fiado vendido</span><strong>${fmtMoneyPesos(report.credit_total)}</strong></div>
      <div><span>Consumo interno (a costo)</span><strong>${fmtMoneyPesos(report.internal_total ?? 0)}</strong></div>
      <p class="hint">${period === "dia"
        ? "El día descuenta su parte de gastos fijos; es normal que salga negativo hasta cubrir la meta diaria (Inicio › Metas)."
        : "Lo que te queda libre = ganancia de la mercancía − gastos fijos − otros gastos. No se restan las compras de mercancía porque ya están incluidas en el costo de cada venta."}</p>
    `;

  const render = (): void => {
    renderChips();
    renderWeekReport(ctx, weekEl, currentScope());
    if (dateInput.value) {
      const range = dayRange(dateInput.value);
      setHtml(dailyEl, summaryRows(ctx.reports.periodReport(currentScope(), range.start, range.end), "dia"));
    }
    if (monthInput.value) {
      const month = monthInput.value;
      const closing = ctx.repos.closings.list().find((row) => row.month === month && row.branch_id === currentScope());
      setHtml(
        monthEl,
        html`
          ${closing
            ? html`<div class="notice closing-open">
                <strong>Este mes está cerrado.</strong>
                <p class="hint">Se cerró el ${fmtDateTime(closing.closed_at)}. Si fue un error, reábrelo; las ventas y gastos no cambian.</p>
                ${ctx.auth.isAdmin() ? html`<button class="ghost small-btn" type="button" data-reopen="${closing.id}">Reabrir mes</button>` : html``}
              </div>`
            : html``}
          ${summaryRows(ctx.reports.monthReport(currentScope(), month))}
        `
      );
      const closeButton = root.querySelector<HTMLButtonElement>("#closeMonth");
      if (closeButton) closeButton.textContent = closing ? "Reemplazar cierre" : "Cerrar mes";
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
                ${ctx.auth.isAdmin()
                  ? html`<div class="actions"><button class="ghost small-btn" type="button" data-reopen="${closing.id}">Reabrir</button></div>`
                  : html``}
              </div>
            `
          )}`
        : html`<p class="muted">Aún no hay meses cerrados.</p>`
    );
  };

  const reopenMonth = async (id: string): Promise<void> => {
    if (!ctx.auth.isAdmin()) {
      ctx.toast("Solo el administrador puede reabrir meses");
      return;
    }
    const closing = ctx.repos.closings.byId(id);
    if (!closing) return;
    const confirmed = await confirmDialog({
      title: "Reabrir mes",
      message: `Se quitará el cierre de ${closing.month} (${ctx.branches.name(closing.branch_id)}). Las ventas y los gastos no cambian.`,
      confirmLabel: "Reabrir",
      danger: true
    });
    if (!confirmed) return;
    ctx.repos.closings.softDelete(closing.id);
    ctx.toast(`Mes ${closing.month} reabierto`);
    render();
  };
  const wireReopen = (element: HTMLElement): void => {
    element.addEventListener("click", (event) => {
      const button = (event.target as HTMLElement).closest<HTMLElement>("[data-reopen]");
      if (button) void reopenMonth(button.dataset.reopen!);
    });
  };
  wireReopen(monthEl);
  wireReopen(closingsEl);

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
    if (month >= monthInputValue()) {
      const proceed = await confirmDialog({
        title: "Mes en curso",
        message: `Estás cerrando ${month}, que todavía no termina. El cierre guarda solo lo que va hasta hoy; las ventas de los días restantes no se incluirán. ¿Continuar?`,
        confirmLabel: "Continuar",
        danger: true
      });
      if (!proceed) return;
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

  return { renderReports: render };
}
