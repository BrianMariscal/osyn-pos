import { html, setHtml, type SafeHtml } from "../../../core/html";
import { fmtMoney, fmtMoneyPesos, toCents } from "../../../core/money";
import { type PeriodReport } from "../../../core/types";
import { VIEW_ALL } from "../../../domain/app-state";
import { type InicioScene, type Tone } from "./scene";

// ---------------- Hoy: resumen en cuatro cifras ----------------

export function renderHero(scene: InicioScene, scope: string, today: PeriodReport, month: PeriodReport, isManager: boolean): void {
  const { ctx, ui } = scene;
  const salesCents = toCents(today.sales_total);
  const avg = today.sales_count ? Math.round(salesCents / today.sales_count) : 0;
  const customers = ctx.repos.customers.list().filter((customer) => scene.inScope(scope, customer.branch_id));
  const owed = Math.round(customers.reduce((sum, customer) => sum + customer.balance, 0) * 100) / 100;
  const debtors = customers.filter((customer) => customer.balance > 0).length;
  const kpi = (label: string, value: string, hint: string, tone: Tone): SafeHtml =>
    html`<div class="hero-kpi" data-tone="${tone}"><span>${label}</span><strong>${value}</strong><small>${hint}</small></div>`;

  const kpis = isManager
    ? [
        kpi("Vendiste hoy", fmtMoneyPesos(today.sales_total), `${today.sales_count} ${today.sales_count === 1 ? "venta" : "ventas"}`, "blue"),
        kpi("Ganancia de hoy", fmtMoneyPesos(today.gross_profit), "Después de la mercancía", "green"),
        kpi("Gastos del mes", fmtMoneyPesos(month.expenses_total), "Renta, luz, sueldos y otros", "coral"),
        kpi("Te deben", fmtMoneyPesos(owed), `${debtors} ${debtors === 1 ? "cliente" : "clientes"}`, "amber")
      ]
    : [
        kpi("Vendiste hoy", fmtMoneyPesos(today.sales_total), `${today.sales_count} ${today.sales_count === 1 ? "venta" : "ventas"}`, "blue"),
        kpi("Ticket promedio", fmtMoneyPesos(avg), "Por venta", "teal"),
        kpi("Devoluciones", fmtMoneyPesos(today.returns_total ?? 0), "Del día", "coral")
      ];

  setHtml(ui.heroCard, html`<div class="hero-kpis">${kpis}</div>`);
}

// ---------------- Para hoy ----------------

export function renderGoals(scene: InicioScene, scope: string, today: PeriodReport, month: PeriodReport): void {
  const { ctx, ui } = scene;
  const target = ctx.expenses.dailyTargetCents(scope);
  const earned = toCents(today.gross_profit);
  const dayPct = target > 0 ? Math.max(0, Math.min(100, Math.round((earned / target) * 100))) : 0;
  const dayMissing = Math.max(0, target - earned);
  const margin = month.sales_total > 0 ? month.gross_profit / month.sales_total : today.sales_total > 0 ? today.gross_profit / today.sales_total : 0;

  if (target <= 0) {
    setHtml(
      ui.goalsCard,
      html`
        <div class="card-head"><h2>Para hoy</h2></div>
        <p class="hint">Aún no hay gastos fijos. Agrega la renta, la luz o los sueldos para saber cuánto necesitas ganar al día.</p>
        <button class="ghost block" type="button" data-go="gastos">Agregar gastos fijos</button>
      `
    );
    return;
  }

  setHtml(
    ui.goalsCard,
    html`
      <div class="card-head"><h2>Para hoy</h2></div>
      <div class="goal">
        <div class="goal-ring ${dayPct >= 100 ? "done" : ""}" style="--p:${dayPct}"><strong>${dayPct}%</strong></div>
        <div class="goal-text">
          <span class="micro">Ganancia de hoy</span>
          <strong>${fmtMoney(earned)} <small class="muted">de ${fmtMoney(target)}</small></strong>
          <span class="hint">${dayMissing > 0
            ? `Te faltan ${fmtMoney(dayMissing)} para cubrir los gastos de hoy${margin > 0 ? ` (≈ vender ${fmtMoney(Math.round(dayMissing / margin))})` : ""}.`
            : "¡Ya cubriste los gastos de hoy!"}</span>
        </div>
      </div>
      <p class="hint">Los gastos fijos se reparten entre los días del mes; si hoy no alcanza, no significa que pierdas.</p>
    `
  );
}

// ---------------- Mes: resumen, no reporte ----------------

export function renderMonth(scene: InicioScene, scope: string, month: PeriodReport): void {
  const { ctx, ui } = scene;
  const money = fmtMoneyPesos;
  const sales = Math.max(month.sales_total, 0);
  const gross = month.gross_profit;
  const expenses = month.expenses_total;
  const net = month.profit_after_expenses;
  const coverage = expenses > 0 ? Math.max(0, Math.min(100, Math.round((gross / expenses) * 100))) : 100;
  const start = new Date(month.start);
  const now = new Date();
  const current = start.getFullYear() === now.getFullYear() && start.getMonth() === now.getMonth();
  const period = current
    ? "Este mes a la fecha"
    : start.toLocaleDateString("es-MX", { month: "long", year: "numeric" });

  setHtml(
    ui.monthCard,
    html`
      <div class="card-head">
        <div><h2>Este mes</h2><p class="hint">${period} · ${scope === VIEW_ALL ? "Todas las sucursales" : ctx.branches.name(scope)}</p></div>
        <button class="link-btn" type="button" data-go="reportes">Ver reporte completo</button>
      </div>
      <div class="month-lines">
        <div><span>Vendiste</span><strong>${money(sales)}</strong></div>
        <div><span>Ganancia después de la mercancía</span><strong>${money(gross)}</strong></div>
        <div><span>Gastos</span><strong>${money(expenses)}</strong></div>
        <div class="month-net ${net < 0 ? "neg" : "pos"}"><span>Te queda</span><strong>${money(net)}</strong></div>
      </div>
      <div class="month-progress">
        <div class="bar-track"><div class="bar-fill" style="width:${coverage}%"></div></div>
        <p class="hint">${net < 0
          ? `Cubres ${coverage}% de los gastos del mes. Te faltan ${money(Math.abs(net))} de ganancia.`
          : `Cubres ${coverage}% de los gastos del mes. Te quedan ${money(net)}.`}</p>
      </div>
      <p class="hint">Gastos incluye renta, luz, sueldos y otros. No incluye compras de mercancía ni fiado; eso está en Reportes.</p>
    `
  );
}
