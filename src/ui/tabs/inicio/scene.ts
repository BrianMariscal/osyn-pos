import { html, setHtml, type SafeHtml } from "../../../core/html";
import { dayRange, toInputDateValue } from "../../../core/dates";
import { toCents } from "../../../core/money";
import { type PeriodReport } from "../../../core/types";
import { isRevenueSale } from "../../../domain/sale-groups";
import { VIEW_ALL } from "../../../domain/app-state";
import type { AppContext } from "../../context";

export type Tone = "blue" | "teal" | "green" | "amber" | "coral" | "violet";
export type RankPeriod = "day" | "week" | "month";

/** Tarjetas del inicio (una referencia por sección del dashboard). */
export interface InicioRefs {
  scopeChips: HTMLElement;
  greetingEl: HTMLElement;
  heroCard: HTMLElement;
  goalsCard: HTMLElement;
  weekCard: HTMLElement;
  monthCard: HTMLElement;
  rankCard: HTMLElement;
  lowCard: HTMLElement;
  creditCard: HTMLElement;
  rankBodyEl: HTMLElement;
  rankPeriodEl: HTMLElement;
}

/** Base compartida del inicio: markup, referencias y consultas por periodo. */
export interface InicioScene {
  ctx: AppContext;
  root: HTMLElement;
  ui: InicioRefs;
  dayStart(offsetDays: number): Date;
  dayReport(scope: string, offsetDays: number): PeriodReport;
  inScope(scope: string, branchId: string | null | undefined): boolean;
  hourly(scope: string, offsetDays: number): number[];
}

export function createInicioScene(root: HTMLElement, ctx: AppContext): InicioScene {
  setHtml(root, inicioMarkup());
  const ui = collectRefs(root);

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

  /** Ventas por hora de un día (centavos): con ingreso y netas de devoluciones. */
  const hourly = (scope: string, offsetDays: number): number[] => {
    const start = dayStart(offsetDays).toISOString();
    const end = dayStart(offsetDays - 1).toISOString();
    const hours = new Array<number>(24).fill(0);
    for (const sale of ctx.repos.sales.list()) {
      if (!inScope(scope, sale.branch_id) || sale.created_at < start || sale.created_at >= end || !isRevenueSale(sale)) continue;
      hours[new Date(sale.created_at).getHours()]! += toCents(sale.total);
    }
    // Las devoluciones bajan las ventas de la hora en que se hicieron.
    for (const ret of ctx.repos.returns.list()) {
      if (!inScope(scope, ret.branch_id) || ret.created_at < start || ret.created_at >= end) continue;
      hours[new Date(ret.created_at).getHours()]! -= toCents(ret.total);
    }
    return hours;
  };

  return { ctx, root, ui, dayStart, dayReport, inScope, hourly };
}

function inicioMarkup(): SafeHtml {
  return html`
    <header class="dash-head">
      <div id="greeting"></div>
      <div class="dash-actions"><div id="scopeChips"></div></div>
    </header>
    <div class="dash">
      <section class="card hero-card span-2" id="heroCard"></section>
      <section class="card goals-card" id="goalsCard"></section>
      <section class="card" id="monthCard"></section>
      <section class="card span-2" id="weekCard"></section>
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
      <section class="card">
        <div class="card-head"><h2>Reportes</h2></div>
        <p class="hint">El detalle de ventas, gastos y ganancias del día, del mes o acumulado está en Reportes.</p>
        <button class="primary block" type="button" data-go="reportes">Ver reportes</button>
      </section>
    </div>
  `;
}

function collectRefs(root: HTMLElement): InicioRefs {
  return {
    scopeChips: root.querySelector<HTMLElement>("#scopeChips")!,
    greetingEl: root.querySelector<HTMLElement>("#greeting")!,
    heroCard: root.querySelector<HTMLElement>("#heroCard")!,
    goalsCard: root.querySelector<HTMLElement>("#goalsCard")!,
    weekCard: root.querySelector<HTMLElement>("#weekCard")!,
    monthCard: root.querySelector<HTMLElement>("#monthCard")!,
    rankCard: root.querySelector<HTMLElement>("#rankCard")!,
    lowCard: root.querySelector<HTMLElement>("#lowCard")!,
    creditCard: root.querySelector<HTMLElement>("#creditCard")!,
    rankBodyEl: root.querySelector<HTMLElement>("#rankBody")!,
    rankPeriodEl: root.querySelector<HTMLElement>("#rankPeriod")!
  };
}
