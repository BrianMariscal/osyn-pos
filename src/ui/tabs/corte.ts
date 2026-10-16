import { html, setHtml } from "../../core/html";
import { fmtDateTime, todayInputValue } from "../../core/dates";
import { fmtMoneyPesos, toCents, toPesos } from "../../core/money";
import { fmtQty } from "../../core/qty";
import { confirmDialog } from "../components/modal";
import { openModal } from "../components/modal";
import { openWhatsapp } from "../whatsapp";
import type { Shift } from "../../core/types";
import { mountSections } from "../sections";
import type { TabModule } from "./tab-module";

export const corteTab: TabModule = {
  id: "corte",
  render(root, ctx) {
    setHtml(
      root,
      html`
        <div class="split">
          <article class="card">
            <h2>Corte de caja</h2>
            <form id="shiftForm" class="form">
              <div class="row">
                <label class="form-field">Base inicial de caja
                  <input id="openingCash" class="input" type="number" step="0.01" min="0" inputmode="decimal" placeholder="0.00">
                </label>
                <label class="form-field">Efectivo contado
                  <input id="cashCounted" class="input" type="number" step="0.01" min="0" inputmode="decimal" placeholder="0.00">
                </label>
              </div>
              <div class="row">
                <label class="form-field">Retirado / entregado
                  <input id="cashWithdrawn" class="input" type="number" step="0.01" min="0" inputmode="decimal" placeholder="0.00">
                </label>
                <label class="form-field">Base siguiente día
                  <input id="nextOpeningCash" class="input" type="number" step="0.01" min="0" inputmode="decimal" placeholder="0.00">
                </label>
              </div>
              <label class="form-field">Notas
                <textarea id="cashNotes" class="input" rows="2" placeholder="Notas del corte"></textarea>
              </label>
            </form>
            <div id="cashSummary" class="summary"></div>
            <div class="actions">
              <button id="closeShift" class="primary" type="button">Cerrar corte</button>
              <button id="sendWhatsapp" class="ghost" type="button">Enviar por WhatsApp</button>
            </div>
          </article>
          <article class="card">
            <h2>Historial de cortes</h2>
            <div id="shiftsList" class="list"></div>
          </article>
        </div>
      `
    );

    // En celular: una sección a la vez (en computadora van lado a lado)
    const articles = [...root.querySelectorAll<HTMLElement>(":scope > .split > article")];
    mountSections(root, [
      { id: "corte", label: "Corte de caja", el: articles[0] ?? null },
      { id: "historial", label: "Historial", el: articles[1] ?? null }
    ]);

    const opening = root.querySelector<HTMLInputElement>("#openingCash")!;
    const counted = root.querySelector<HTMLInputElement>("#cashCounted")!;
    const withdrawn = root.querySelector<HTMLInputElement>("#cashWithdrawn")!;
    const nextBase = root.querySelector<HTMLInputElement>("#nextOpeningCash")!;
    const notes = root.querySelector<HTMLTextAreaElement>("#cashNotes")!;
    const summaryEl = root.querySelector<HTMLElement>("#cashSummary")!;
    const historyEl = root.querySelector<HTMLElement>("#shiftsList")!;

    const branchId = (): string => ctx.branches.operationalId();

    const renderSummary = (): void => {
      const summary = ctx.shifts.summarize(branchId());
      const openingValue = Number(opening.value || 0);
      const countedValue = Number(counted.value || 0);
      const withdrawnValue = Number(withdrawn.value || 0);
      const nextValue = Number(nextBase.value || 0);
      const expectedWithBase = toPesos(toCents(openingValue) + toCents(summary.efectivoEsperado));
      const difference = toPesos(toCents(countedValue) - toCents(expectedWithBase));
      const rest = toPesos(toCents(summary.ventas) - toCents(summary.cigarros ?? 0) - toCents(summary.cerveza ?? 0));
      const rows: Array<[string, string, string?]> = [
        ["Base inicial", fmtMoneyPesos(openingValue)],
        ["Ventas", fmtMoneyPesos(summary.ventas), "strong"],
        ["  Cigarros", fmtMoneyPesos(summary.cigarros ?? 0), "group"],
        ["  Cerveza", fmtMoneyPesos(summary.cerveza ?? 0), "group"],
        ["  Resto de productos", fmtMoneyPesos(rest), "group"],
        ["Efectivo vendido", fmtMoneyPesos(summary.efectivo)],
        ["Transferencia", fmtMoneyPesos(summary.transferencia)],
        ["Tarjeta", fmtMoneyPesos(summary.tarjeta)],
        ["Fiado", fmtMoneyPesos(summary.fiado)],
        ["Consumo interno (a costo, no es venta)", fmtMoneyPesos(summary.interno ?? 0)],
        ["Gastos extra (de caja)", fmtMoneyPesos(summary.gastos)],
        ["Proveedores (pagado de caja)", fmtMoneyPesos(summary.proveedores)],
        ["Compras pagadas aparte (no salen de caja)", fmtMoneyPesos(summary.proveedoresAparte ?? 0)],
        ["Mermas", fmtMoneyPesos(summary.mermas)],
        ["Devoluciones", fmtMoneyPesos(summary.devoluciones ?? 0)],
        ["  Reembolsadas en efectivo (salen de caja)", fmtMoneyPesos(summary.devolucionesEfectivo ?? 0), "group"],
        ["Ganancia estimada", fmtMoneyPesos(summary.ganancia)],
        ["Efectivo esperado con base", fmtMoneyPesos(expectedWithBase), "strong"],
        ["Efectivo contado", fmtMoneyPesos(countedValue)],
        ["Diferencia contra esperado", fmtMoneyPesos(difference), difference < 0 ? "neg" : difference > 0 ? "pos" : "strong"],
        ["Retirado / entregado", fmtMoneyPesos(withdrawnValue)],
        ["Base siguiente día", fmtMoneyPesos(nextValue)],
        ["Sin repartir (contado − retiro − base)", fmtMoneyPesos(toPesos(toCents(countedValue) - toCents(withdrawnValue) - toCents(nextValue)))]
      ];
      setHtml(
        summaryEl,
        html`${rows.map(([label, value, kind]) => html`<div class="${kind ? `row-${kind}` : ""}"><span>${label.trim()}</span><strong>${value}</strong></div>`)}`
      );
    };

    const renderHistory = (): void => {
      const shifts = ctx.shifts.history(branchId());
      setHtml(
        historyEl,
        shifts.length
          ? html`${shifts.map(
              (shift) => html`
                <div class="list-item">
                  <div class="item-line">
                    <strong>${fmtDateTime(shift.closed_at)}</strong>
                    <strong>${fmtMoneyPesos(shift.summary?.ventas ?? 0)}</strong>
                  </div>
                  <p class="muted">Cigarros ${fmtMoneyPesos(shift.summary?.cigarros ?? 0)} | Cerveza ${fmtMoneyPesos(shift.summary?.cerveza ?? 0)} | Dif ${fmtMoneyPesos(shift.difference)} | Base siguiente ${fmtMoneyPesos(shift.next_opening_cash)}</p>
                  ${shift.notes ? html`<p class="muted">Notas: ${shift.notes}</p>` : html``}
                </div>
              `
            )}`
          : html`<p class="muted">Aún no hay cortes cerrados.</p>`
      );
    };

    const renderAll = (): void => {
      renderSummary();
      renderHistory();
    };

    // Base inicial sugerida: la base dejada por el último corte.
    if (!opening.value) {
      const last = ctx.shifts.lastShift(branchId());
      const suggested = last?.next_opening_cash || 0;
      if (suggested) opening.value = String(suggested);
    }

    [opening, counted, withdrawn, nextBase].forEach((input) => input.addEventListener("input", renderSummary));

    const buildMessage = (shift: Shift, reportForTop: { top_products: Array<{ name: string; qty: number; um: string }>; slow_products: Array<{ name: string; qty: number; um: string }> }): string => {
      const s = shift.summary;
      const storeName = ctx.store.getState().settings.storeName || "Mi tienda";
      const top = reportForTop.top_products
        .slice(0, 10)
        .map((p, i) => `${i + 1}. ${p.name}: ${fmtQty(p.qty)} ${p.um}`)
        .join("\n") || "Sin ventas";
      const slow = reportForTop.slow_products
        .slice(0, 10)
        .map((p, i) => `${i + 1}. ${p.name}: ${fmtQty(p.qty)} ${p.um}`)
        .join("\n") || "Sin productos";
      return [
        storeName,
        "CIERRE DEL DÍA / CORTE DE CAJA",
        `Fecha: ${fmtDateTime(shift.closed_at)}`,
        `Base inicial: ${fmtMoneyPesos(shift.opening_cash)}`,
        `Ventas: ${fmtMoneyPesos(s.ventas)}`,
        `  - Cigarros: ${fmtMoneyPesos(s.cigarros ?? 0)}`,
        `  - Cerveza: ${fmtMoneyPesos(s.cerveza ?? 0)}`,
        `  - Resto: ${fmtMoneyPesos(toPesos(toCents(s.ventas) - toCents(s.cigarros ?? 0) - toCents(s.cerveza ?? 0)))}`,
        `Efectivo vendido: ${fmtMoneyPesos(s.efectivo)}`,
        `Transferencia: ${fmtMoneyPesos(s.transferencia)}`,
        `Tarjeta: ${fmtMoneyPesos(s.tarjeta)}`,
        `Fiado: ${fmtMoneyPesos(s.fiado)}`,
        `Consumo interno (a costo): ${fmtMoneyPesos(s.interno ?? 0)}`,
        `Gastos extra: ${fmtMoneyPesos(s.gastos)}`,
        `Proveedores (de caja): ${fmtMoneyPesos(s.proveedores)}`,
        ...(s.proveedoresAparte ? [`Compras pagadas aparte: ${fmtMoneyPesos(s.proveedoresAparte)}`] : []),
        `Mermas: ${fmtMoneyPesos(s.mermas)}`,
        ...(s.devoluciones ? [`Devoluciones: ${fmtMoneyPesos(s.devoluciones)} (en efectivo: ${fmtMoneyPesos(s.devolucionesEfectivo ?? 0)})`] : []),
        `Ganancia estimada: ${fmtMoneyPesos(s.ganancia)}`,
        `Efectivo esperado con base: ${fmtMoneyPesos(shift.expected_cash_with_base)}`,
        `Efectivo contado: ${fmtMoneyPesos(shift.counted_cash)}`,
        `Dinero retirado/entregado: ${fmtMoneyPesos(shift.withdrawn_cash)}`,
        `Base para siguiente día: ${fmtMoneyPesos(shift.next_opening_cash)}`,
        `Diferencia contra esperado: ${fmtMoneyPesos(shift.difference)}`,
        `Diferencia contado vs retirado+base: ${fmtMoneyPesos(shift.distribution_difference)}`,
        "",
        "TOP 10 MÁS VENDIDOS",
        top,
        "",
        "10 MENOR ROTACIÓN",
        slow,
        "",
        `Notas: ${shift.notes || "Sin notas"}`
      ].join("\n");
    };

    const reportAround = (closedAt: string): { top_products: Array<{ name: string; qty: number; um: string }>; slow_products: Array<{ name: string; qty: number; um: string }> } => {
      const shifts = ctx.shifts.history(branchId(), 2);
      const previous = shifts.find((shift) => shift.closed_at < closedAt);
      const start = previous?.closed_at ?? new Date(`${todayInputValue()}T00:00:00`).toISOString();
      return ctx.reports.periodReport(branchId(), start, closedAt);
    };

    root.querySelector<HTMLButtonElement>("#closeShift")!.addEventListener("click", async () => {
      const summary = ctx.shifts.summarize(branchId());
      const confirmed = await confirmDialog({
        title: "Cerrar corte",
        message: `Ventas: ${fmtMoneyPesos(summary.ventas)} | Efectivo esperado: ${fmtMoneyPesos(summary.efectivoEsperado)}. Se cerrará el corte de esta sucursal.`,
        confirmLabel: "Cerrar corte"
      });
      if (!confirmed) return;
      const shift = ctx.shifts.closeShift({
        opening_cash: Number(opening.value || 0),
        counted_cash: Number(counted.value || 0),
        withdrawn_cash: Number(withdrawn.value || 0),
        next_opening_cash: Number(nextBase.value || 0),
        notes: notes.value
      });
      ctx.toast(`Corte cerrado: ${fmtMoneyPesos(shift.summary.ventas)} en ventas`);
      opening.value = String(shift.next_opening_cash || "");
      counted.value = "";
      withdrawn.value = "";
      nextBase.value = "";
      notes.value = "";
      renderAll();
    });

    root.querySelector<HTMLButtonElement>("#sendWhatsapp")!.addEventListener("click", () => {
      const settings = ctx.store.getState().settings;
      const numbers = [settings.whatsappNumber, settings.whatsapp2, settings.whatsapp3]
        .map((number) => (number || "").trim())
        .filter(Boolean);
      if (!numbers.length) {
        ctx.toast("Configura un número de WhatsApp en Ajustes");
        return;
      }
      const last = ctx.shifts.lastShift(branchId());
      if (!last) {
        ctx.toast("Primero cierra un corte");
        return;
      }
      const report = reportAround(last.closed_at);
      const message = buildMessage(last, report);
      if (numbers.length === 1) {
        openWhatsapp(numbers[0]!, message);
        return;
      }
      // Varios números: enlaces directos (evita el bloqueo de pop-ups)
      openModal({
        title: "Enviar corte por WhatsApp",
        content: html`
          <p class="muted">Toca cada número para enviarle el corte.</p>
          <div class="more-list">
            ${numbers.map(
              (number) => html`
                <a class="ghost more-item wa-link" href="https://wa.me/${number.replace(/\D/g, "")}?text=${encodeURIComponent(message)}" target="_blank" rel="noopener">${number}</a>
              `
            )}
          </div>
        `,
        actions: [{ label: "Cerrar", kind: "primary" }]
      });
    });

    // Gancho del asistente IA
    ctx.hooks.prepareShiftClose = (input) => {
      if (input.opening_cash !== undefined) opening.value = String(input.opening_cash || 0);
      if (input.counted_cash !== undefined) counted.value = String(input.counted_cash || 0);
      if (input.withdrawn_cash !== undefined) withdrawn.value = String(input.withdrawn_cash || 0);
      if (input.next_opening_cash !== undefined) nextBase.value = String(input.next_opening_cash || 0);
      if (input.notes) notes.value = input.notes;
      renderSummary();
    };

    ctx.store.watch(
      (s) => [s.sales, s.returns, s.expenses, s.purchases, s.mermas, s.shifts, s.products, s.branches, s.currentBranchId] as const,
      renderAll
    );
    renderAll();
  }
};
