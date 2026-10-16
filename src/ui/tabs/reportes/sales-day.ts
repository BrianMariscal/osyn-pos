import { dayRange, todayInputValue, toInputDateValue } from "../../../core/dates";
import { html, setHtml } from "../../../core/html";
import { fmtMoney, fmtMoneyPesos, sumCents, toCents } from "../../../core/money";
import { fmtQty } from "../../../core/qty";
import { PAYMENT_LABELS, type PaymentMethod } from "../../../core/types";
import { VIEW_ALL } from "../../../domain/app-state";
import { saleFolio } from "../../../domain/ticket";
import { paginate, pagerClick, pagerMarkup } from "../../pager";
import { openReturnFlow } from "../../return-flow";
import { openTicket } from "../../ticket";
import type { ReportesScene } from "./scene";

/** Ventas del día: tickets de un día con su resumen (devoluciones ya restadas). */
export function mountSalesDay(scene: ReportesScene): { renderSalesDay(): void } {
  const { ctx, ui, state, currentScope } = scene;
  const { salesDayInput, salesDaySummary, salesDayList, salesDayCard } = ui;

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
    // Las devoluciones del día bajan el total y su forma de pago (el abono a fiado, el fiado).
    const scope = currentScope();
    const range = dayRange(salesDayInput.value || todayInputValue());
    let returnsCents = 0;
    for (const ret of ctx.repos.returns.list()) {
      if ((scope !== VIEW_ALL && ret.branch_id !== scope) || ret.created_at < range.start || ret.created_at >= range.end) continue;
      returnsCents += toCents(ret.total);
      byPayment.set(ret.payment, Math.max(0, (byPayment.get(ret.payment) ?? 0) - toCents(ret.total)));
    }
    const totalCents = sumCents(revenue.map((sale) => toCents(sale.total))) - returnsCents;
    const tones: Record<string, string> = { efectivo: "green", transferencia: "blue", tarjeta: "violet", fiado: "amber" };
    setHtml(
      salesDaySummary,
      html`
        <div data-tone="blue"><span>Total vendido</span><strong>${fmtMoney(totalCents)}</strong></div>
        <div data-tone="teal"><span>Tickets</span><strong>${revenue.length}</strong></div>
        ${[...byPayment.entries()].map(
          ([payment, cents]) => html`<div data-tone="${tones[payment] ?? "blue"}"><span>${PAYMENT_LABELS[payment as PaymentMethod] ?? payment}</span><strong>${fmtMoney(cents)}</strong></div>`
        )}
        ${returnsCents > 0 ? html`<div data-tone="coral"><span>Devoluciones (ya restadas)</span><strong>${fmtMoney(returnsCents)}</strong></div>` : html``}
      `
    );
    if (!sales.length) {
      setHtml(salesDayList, html`<p class="empty-note">No hay ventas este día.</p>`);
      return;
    }
    const returnedBySale = new Map<string, number>();
    for (const ret of ctx.repos.returns.list()) {
      returnedBySale.set(ret.sale_id, (returnedBySale.get(ret.sale_id) ?? 0) + toCents(ret.total));
    }
    const page = paginate(sales, state.salesDayPage, 10);
    setHtml(
      salesDayList,
      html`${page.items.map((sale) => {
        const pieces = sale.items.reduce((sum, item) => sum + (item.pack_size ? item.qty * item.pack_size : item.qty), 0);
        const names = sale.items.map((item) => item.name).join(", ");
        const returnedCents = returnedBySale.get(sale.id) ?? 0;
        return html`
          <button class="ticket-row" type="button" data-ticket="${sale.id}">
            <span class="ticket-row-time">${new Date(sale.created_at).toLocaleTimeString("es-MX", { hour: "2-digit", minute: "2-digit" })}</span>
            <span class="row-title"><strong>${names}</strong><small class="muted">Folio ${saleFolio(sale)} · ${fmtQty(pieces)} art.${sale.cashier ? ` · ${sale.cashier}` : ""}</small></span>
            <span class="tag" data-tone="${tones[sale.payment] ?? "teal"}">${PAYMENT_LABELS[sale.payment]}</span>
            ${returnedCents > 0 ? html`<span class="tag" data-tone="coral" title="Reembolsado: ${fmtMoney(returnedCents)}">Devolución</span>` : html``}
            <strong class="row-price">${fmtMoneyPesos(sale.total)}</strong>
          </button>
        `;
      })}${pagerMarkup("salesDay", page)}`
    );
  };

  salesDayInput.addEventListener("change", () => {
    state.salesDayPage = 0;
    renderSalesDay();
  });
  salesDayCard.addEventListener("click", (event) => {
    const target = event.target as HTMLElement;
    const shift = target.closest<HTMLElement>("[data-day-shift]");
    if (shift || target.closest("[data-day-today]")) {
      const base = salesDayInput.value ? new Date(`${salesDayInput.value}T12:00:00`) : new Date();
      if (shift) base.setDate(base.getDate() + Number(shift.dataset.dayShift));
      salesDayInput.value = shift ? toInputDateValue(base) : todayInputValue();
      state.salesDayPage = 0;
      renderSalesDay();
      return;
    }
    const paging = pagerClick(event);
    if (paging) {
      state.salesDayPage = paging.page;
      renderSalesDay();
      return;
    }
    const row = target.closest<HTMLElement>("[data-ticket]");
    const sale = row && ctx.repos.sales.byId(row.dataset.ticket!);
    if (sale) openTicket(ctx, sale, { onReturn: () => openReturnFlow(ctx, sale) });
  });

  return { renderSalesDay };
}
