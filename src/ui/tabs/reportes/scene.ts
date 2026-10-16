import { todayInputValue } from "../../../core/dates";
import { html, setHtml, type SafeHtml } from "../../../core/html";
import type { AppContext } from "../../context";
import { mountSections } from "../../sections";

/** Referencias de reportes (una por tarjeta y control del markup). */
export interface ReportesRefs {
  salesDayCard: HTMLElement;
  salesDayInput: HTMLInputElement;
  salesDaySummary: HTMLElement;
  salesDayList: HTMLElement;
  dateInput: HTMLInputElement;
  monthInput: HTMLInputElement;
  scopeChips: HTMLElement;
  dailyEl: HTMLElement;
  monthEl: HTMLElement;
  closingsEl: HTMLElement;
}

/** Base compartida de reportes: markup, referencias y alcance por sucursal. */
export interface ReportesScene {
  ctx: AppContext;
  root: HTMLElement;
  ui: ReportesRefs;
  state: { salesDayPage: number };
  currentScope(): string;
}

export function createReportesScene(root: HTMLElement, ctx: AppContext): ReportesScene {
  setHtml(root, reportesMarkup());
  const ui = collectRefs(root);

  // En celular: una sección a la vez (en computadora van lado a lado)
  const articles = [...root.querySelectorAll<HTMLElement>(":scope > .split > article")];
  mountSections(root, [
    { id: "ventas", label: "Ventas del día", el: articles[0] ?? null },
    { id: "reportes", label: "Reportes", el: articles[1] ?? null },
    { id: "cierre", label: "Cierre mensual", el: articles[2] ?? null }
  ]);

  ui.salesDayInput.value = todayInputValue();

  return {
    ctx,
    root,
    ui,
    state: { salesDayPage: 0 },
    currentScope: (): string => ctx.branches.viewScope()
  };
}

function reportesMarkup(): SafeHtml {
  return html`
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
  `;
}

function collectRefs(root: HTMLElement): ReportesRefs {
  return {
    salesDayCard: root.querySelector<HTMLElement>("#salesDayCard")!,
    salesDayInput: root.querySelector<HTMLInputElement>("#salesDay")!,
    salesDaySummary: root.querySelector<HTMLElement>("#salesDaySummary")!,
    salesDayList: root.querySelector<HTMLElement>("#salesDayList")!,
    dateInput: root.querySelector<HTMLInputElement>("#reportDate")!,
    monthInput: root.querySelector<HTMLInputElement>("#monthClose")!,
    scopeChips: root.querySelector<HTMLElement>("#reportScopeChips")!,
    dailyEl: root.querySelector<HTMLElement>("#dailyReportSummary")!,
    monthEl: root.querySelector<HTMLElement>("#monthReportSummary")!,
    closingsEl: root.querySelector<HTMLElement>("#monthClosingsList")!
  };
}
