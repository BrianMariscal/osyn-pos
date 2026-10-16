import { html, setHtml, type SafeHtml } from "../../../core/html";
import { dayRange, monthInputValue, todayInputValue, toInputDateValue } from "../../../core/dates";
import { fmtMoney, fmtMoneyPesos, sumCents, toCents } from "../../../core/money";
import { fmtQty } from "../../../core/qty";
import { PAYMENT_LABELS, type PaymentMethod, type PeriodReport } from "../../../core/types";
import { isRevenueSale } from "../../../domain/sale-groups";
import { VIEW_ALL } from "../../../domain/app-state";
import { type InicioScene, type RankPeriod, type Tone } from "./scene";

const PAYMENT_TONES: Record<string, Tone> = { efectivo: "green", transferencia: "blue", tarjeta: "violet", fiado: "amber", interno: "teal" };

export function barRow(tone: Tone, label: string, value: string, ratio: number, sub = ""): SafeHtml {
  return html`
    <div class="bar-row" data-tone="${tone}">
      <div class="bar-row-head"><span>${label}${sub ? html` <small class="muted">${sub}</small>` : html``}</span><strong>${value}</strong></div>
      <div class="bar-track"><div class="bar-fill" style="width:${Math.max(2, Math.round(Math.min(1, ratio) * 100))}%"></div></div>
    </div>
  `;
}

// ---------------- Más vendido ----------------

/** Lo más vendido: dueño del periodo (hoy, semana o mes) y sin ventas. */
export function createRankCard(scene: InicioScene): { renderRank(scope: string): void; select(period: RankPeriod): void } {
  const { ctx, ui, dayReport } = scene;
  const { rankBodyEl, rankPeriodEl } = ui;
  let rankPeriod: RankPeriod = "day";

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

  const select = (period: RankPeriod): void => {
    rankPeriod = period;
    rankPeriodEl.querySelectorAll<HTMLElement>(".chip").forEach((c) => c.classList.toggle("chip-active", c.dataset.rank === rankPeriod));
    renderRank(ctx.branches.viewScope());
  };

  rankPeriodEl.addEventListener("click", (event) => {
    const chip = (event.target as HTMLElement).closest<HTMLElement>("[data-rank]");
    if (!chip) return;
    select((chip.dataset.rank as RankPeriod) ?? "day");
  });

  return { renderRank, select };
}

// ---------------- Por agotarse ----------------

export function renderLow(scene: InicioScene, scope: string): void {
  const { ctx, inScope, ui } = scene;
  const lowStock = ctx.repos.stocks
    .list()
    .filter((row) => inScope(scope, row.branch_id) && row.stock <= row.min_stock && ctx.repos.products.byId(row.product_id)?.active !== false)
    .sort((a, b) => a.stock - b.stock);
  setHtml(
    ui.lowCard,
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
}

// ---------------- Fiado ----------------

export function renderCredit(scene: InicioScene, scope: string): void {
  const { ctx, inScope, ui } = scene;
  const owing = ctx.repos.customers
    .list()
    .filter((c) => inScope(scope, c.branch_id) && c.balance > 0)
    .sort((a, b) => b.balance - a.balance);
  const total = sumCents(owing.map((c) => toCents(c.balance)));
  const max = Math.max(...owing.map((c) => c.balance), 1);
  setHtml(
    ui.creditCard,
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
}

// ---------------- Vendedor ----------------

export function renderVendorPayments(scene: InicioScene, scope: string): void {
  const { ctx, ui } = scene;
  const range = dayRange(todayInputValue());
  const byPayment = new Map<string, number>();
  for (const sale of ctx.repos.sales.list()) {
    if (sale.branch_id !== scope || sale.created_at < range.start || sale.created_at >= range.end || !isRevenueSale(sale)) continue;
    byPayment.set(sale.payment, (byPayment.get(sale.payment) ?? 0) + toCents(sale.total));
  }
  // Las devoluciones del día bajan su forma de pago (el abono a fiado, el fiado).
  for (const ret of ctx.repos.returns.list()) {
    if (ret.branch_id !== scope || ret.created_at < range.start || ret.created_at >= range.end) continue;
    byPayment.set(ret.payment, Math.max(0, (byPayment.get(ret.payment) ?? 0) - toCents(ret.total)));
  }
  const rows = [...byPayment.entries()].filter(([, cents]) => cents > 0).sort((a, b) => b[1] - a[1]);
  const totalCents = sumCents(rows.map(([, cents]) => cents));
  setHtml(
    ui.goalsCard,
    html`
      <div class="card-head"><h2>Cobros de hoy</h2></div>
      ${rows.length
        ? html`<div class="bar-list">${rows.map(([payment, cents]) =>
            barRow(PAYMENT_TONES[payment] ?? "blue", PAYMENT_LABELS[payment as PaymentMethod] ?? payment, fmtMoney(cents), totalCents ? cents / totalCents : 0)
          )}</div>`
        : html`<p class="empty-note">Aún no hay ventas registradas hoy.</p>`}
    `
  );
}
