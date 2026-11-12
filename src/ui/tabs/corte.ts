import { html, setHtml } from "../../core/html";
import { dayRange, fmtDateTime, toInputDateValue, todayInputValue } from "../../core/dates";
import { fmtMoneyPesos, toCents, toPesos } from "../../core/money";
import { fmtQty } from "../../core/qty";
import { confirmDialog } from "../components/modal";
import { openModal } from "../components/modal";
import { openWhatsapp } from "../whatsapp";
import { summaryHasActivity } from "../../domain/shift-service";
import type { Shift, ShiftSummary } from "../../core/types";
import { mountSections } from "../sections";
import { paginate, pagerClick, pagerMarkup } from "../pager";
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
              <button id="retroShift" class="ghost" type="button">Corte de otro día</button>
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
    let historyPage = 0;

    const renderSummary = (): void => {
      const summary = ctx.shifts.summarize(branchId());
      const openingValue = Number(opening.value || 0);
      const countedValue = Number(counted.value || 0);
      const withdrawnValue = Number(withdrawn.value || 0);
      const nextValue = Number(nextBase.value || 0);
      const expectedWithBase = toPesos(toCents(openingValue) + toCents(summary.efectivoEsperado));
      const difference = toPesos(toCents(countedValue) + toCents(withdrawnValue) - toCents(expectedWithBase));
      const rest = toPesos(toCents(summary.ventas) - toCents(summary.cigarros ?? 0) - toCents(summary.cerveza ?? 0));
      const rows: Array<[string, string, string?]> = [
        ["Base inicial", fmtMoneyPesos(openingValue)],
        ["Ventas", fmtMoneyPesos(summary.ventas), "strong"],
        ["  Cigarros", fmtMoneyPesos(summary.cigarros ?? 0), "group"],
        ["  Cerveza", fmtMoneyPesos(summary.cerveza ?? 0), "group"],
        ["  Resto de productos", fmtMoneyPesos(rest), "group"],
        ["Cobrado en efectivo", fmtMoneyPesos(summary.efectivo)],
        ["Transferencia", fmtMoneyPesos(summary.transferencia)],
        ["Tarjeta", fmtMoneyPesos(summary.tarjeta)],
        ["Fiado", fmtMoneyPesos(summary.fiado)],
        ["Abonos de fiado (cobrados en caja)", fmtMoneyPesos(summary.abonos ?? 0)],
        ["Consumo interno (a costo, no es venta)", fmtMoneyPesos(summary.interno ?? 0)],
        ["Gastos extra (de caja)", fmtMoneyPesos(summary.gastos)],
        ...(summary.gastosAparte ? [["Gastos extra fuera de caja (no afectan efectivo)", fmtMoneyPesos(summary.gastosAparte), "group"] as [string, string, string]] : []),
        ["Proveedores (pagado de caja)", fmtMoneyPesos(summary.proveedores)],
        ["Compras pagadas aparte (no salen de caja)", fmtMoneyPesos(summary.proveedoresAparte ?? 0)],
        ["Mermas", fmtMoneyPesos(summary.mermas)],
        ["Devoluciones (ya restadas)", fmtMoneyPesos(summary.devoluciones ?? 0)],
        ["  Reembolsadas en efectivo (salen de caja)", fmtMoneyPesos(summary.devolucionesEfectivo ?? 0), "group"],
        ["Ganancia estimada", fmtMoneyPesos(summary.ganancia)],
        ["Efectivo esperado con base", fmtMoneyPesos(expectedWithBase), "strong"],
        ["Efectivo contado", fmtMoneyPesos(countedValue)],
        ["Diferencia (contado + retirado − esperado)", fmtMoneyPesos(difference), difference < 0 ? "neg" : difference > 0 ? "pos" : "strong"],
        ["Retirado / entregado", fmtMoneyPesos(withdrawnValue)],
        ["Base siguiente día", fmtMoneyPesos(nextValue)],
        ["Sin repartir (contado − retiro − base)", fmtMoneyPesos(toPesos(toCents(countedValue) - toCents(withdrawnValue) - toCents(nextValue)))]
      ];
      setHtml(
        summaryEl,
        html`${rows.map(([label, value, kind]) => html`<div class="${kind ? `row-${kind}` : ""}"><span>${label.trim()}</span><strong>${value}</strong></div>`)}`
      );
    };

    /** Filas del detalle de un corte ya cerrado (historial). */
    const shiftDetailRows = (shift: Shift): Array<[string, string, string?]> => {
      const s = shift.summary ?? ({} as ShiftSummary);
      const rest = toPesos(toCents(s.ventas ?? 0) - toCents(s.cigarros ?? 0) - toCents(s.cerveza ?? 0));
      return [
        ["Cerrado", fmtDateTime(shift.closed_at)],
        ["Base inicial", fmtMoneyPesos(shift.opening_cash || 0)],
        ["Ventas", fmtMoneyPesos(s.ventas ?? 0), "strong"],
        ["  Cigarros", fmtMoneyPesos(s.cigarros ?? 0), "group"],
        ["  Cerveza", fmtMoneyPesos(s.cerveza ?? 0), "group"],
        ["  Resto de productos", fmtMoneyPesos(rest), "group"],
        ["Cobrado en efectivo", fmtMoneyPesos(s.efectivo ?? 0)],
        ["Transferencia", fmtMoneyPesos(s.transferencia ?? 0)],
        ["Tarjeta", fmtMoneyPesos(s.tarjeta ?? 0)],
        ["Fiado", fmtMoneyPesos(s.fiado ?? 0)],
        ["Abonos de fiado (cobrados en caja)", fmtMoneyPesos(s.abonos ?? 0)],
        ["Consumo interno (a costo, no es venta)", fmtMoneyPesos(s.interno ?? 0)],
        ["Gastos extra (de caja)", fmtMoneyPesos(s.gastos ?? 0)],
        ...(s.gastosAparte ? [["Gastos extra fuera de caja (no afectan efectivo)", fmtMoneyPesos(s.gastosAparte), "group"] as [string, string, string]] : []),
        ["Proveedores (pagado de caja)", fmtMoneyPesos(s.proveedores ?? 0)],
        ["Compras pagadas aparte (no salen de caja)", fmtMoneyPesos(s.proveedoresAparte ?? 0)],
        ["Mermas", fmtMoneyPesos(s.mermas ?? 0)],
        ["Devoluciones (ya restadas)", fmtMoneyPesos(s.devoluciones ?? 0)],
        ["  Reembolsadas en efectivo (salieron de caja)", fmtMoneyPesos(s.devolucionesEfectivo ?? 0), "group"],
        ["Ganancia estimada", fmtMoneyPesos(s.ganancia ?? 0)],
        ["Efectivo esperado con base", fmtMoneyPesos(shift.expected_cash_with_base || 0), "strong"],
        ["Efectivo contado", fmtMoneyPesos(shift.counted_cash || 0)],
        ["Diferencia (contado + retirado − esperado)", fmtMoneyPesos(shift.difference || 0), shift.difference < 0 ? "neg" : shift.difference > 0 ? "pos" : "strong"],
        ["Retirado / entregado", fmtMoneyPesos(shift.withdrawn_cash || 0)],
        ["Base siguiente día", fmtMoneyPesos(shift.next_opening_cash || 0)],
        ["Sin repartir (contado − retiro − base)", fmtMoneyPesos(toPesos(toCents(shift.counted_cash || 0) - toCents(shift.withdrawn_cash || 0) - toCents(shift.next_opening_cash || 0)))]
      ];
    };

    const renderHistory = (): void => {
      const shifts = ctx.shifts.history(branchId(), 200);
      if (!shifts.length) {
        setHtml(historyEl, html`<p class="muted">Aún no hay cortes cerrados.</p>`);
        return;
      }
      const page = paginate(shifts, historyPage, 10);
      setHtml(
        historyEl,
        html`${page.items.map(
          (shift) => html`
            <div class="list-item">
              <div class="item-line">
                <strong>${fmtDateTime(shift.closed_at)}</strong>
                <strong>${fmtMoneyPesos(shift.summary?.ventas ?? 0)}</strong>
              </div>
              <p class="muted">Cigarros ${fmtMoneyPesos(shift.summary?.cigarros ?? 0)} | Cerveza ${fmtMoneyPesos(shift.summary?.cerveza ?? 0)} | Dif ${fmtMoneyPesos(shift.difference)} | Base siguiente ${fmtMoneyPesos(shift.next_opening_cash)}</p>
              ${shift.notes ? html`<p class="muted">Notas: ${shift.notes}</p>` : html``}
              <div class="actions">
                <button class="ghost" type="button" data-shift="${shift.id}">Ver corte</button>
              </div>
            </div>
          `
        )}${pagerMarkup("shifts", page)}`
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
        `Cobrado en efectivo: ${fmtMoneyPesos(s.efectivo)}`,
        `Transferencia: ${fmtMoneyPesos(s.transferencia)}`,
        `Tarjeta: ${fmtMoneyPesos(s.tarjeta)}`,
        `Fiado: ${fmtMoneyPesos(s.fiado)}`,
        ...(s.abonos ? [`Abonos de fiado: ${fmtMoneyPesos(s.abonos)}`] : []),
        `Consumo interno (a costo): ${fmtMoneyPesos(s.interno ?? 0)}`,
        `Gastos extra: ${fmtMoneyPesos(s.gastos)}`,
        ...(s.gastosAparte ? [`Gastos fuera de caja (no afectan efectivo): ${fmtMoneyPesos(s.gastosAparte)}`] : []),
        `Proveedores (de caja): ${fmtMoneyPesos(s.proveedores)}`,
        ...(s.proveedoresAparte ? [`Compras pagadas aparte: ${fmtMoneyPesos(s.proveedoresAparte)}`] : []),
        `Mermas: ${fmtMoneyPesos(s.mermas)}`,
        ...(s.devoluciones ? [`Devoluciones (ya restadas): ${fmtMoneyPesos(s.devoluciones)} (en efectivo: ${fmtMoneyPesos(s.devolucionesEfectivo ?? 0)})`] : []),
        `Ganancia estimada: ${fmtMoneyPesos(s.ganancia)}`,
        `Efectivo esperado con base: ${fmtMoneyPesos(shift.expected_cash_with_base)}`,
        `Efectivo contado: ${fmtMoneyPesos(shift.counted_cash)}`,
        `Dinero retirado/entregado: ${fmtMoneyPesos(shift.withdrawn_cash)}`,
        `Base para siguiente día: ${fmtMoneyPesos(shift.next_opening_cash)}`,
        `Diferencia (contado + retirado − esperado): ${fmtMoneyPesos(shift.difference)}`,
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
      const shifts = ctx.shifts.history(branchId(), 200);
      const previous = shifts.find((shift) => shift.closed_at < closedAt);
      const start = previous?.closed_at ?? dayRange(toInputDateValue(new Date(closedAt))).start;
      return ctx.reports.periodReport(branchId(), start, closedAt);
    };

    /** Envía un corte por WhatsApp a los números configurados en la sucursal. */
    const sendShift = (shift: Shift): void => {
      const numbers = ctx.branches.shiftWhatsappNumbers(branchId());
      if (!numbers.length) {
        ctx.toast("Configura el WhatsApp de esta sucursal en Ajustes > Sucursales");
        return;
      }
      const message = buildMessage(shift, reportAround(shift.closed_at));
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
    };

    const openShiftDetail = (shift: Shift): void => {
      openModal({
        title: `Corte del ${fmtDateTime(shift.closed_at)}`,
        content: html`
          <div class="summary">
            ${shiftDetailRows(shift).map(([label, value, kind]) => html`<div class="${kind ? `row-${kind}` : ""}"><span>${label.trim()}</span><strong>${value}</strong></div>`)}
          </div>
          ${shift.notes ? html`<p class="muted">Notas: ${shift.notes}</p>` : html``}
        `,
        actions: [
          { label: "Enviar por WhatsApp", kind: "ghost", onClick: (close) => { close(); sendShift(shift); } },
          { label: "Cerrar", kind: "primary" }
        ]
      });
    };

    const yesterdayValue = (): string => {
      const date = new Date();
      date.setDate(date.getDate() - 1);
      return toInputDateValue(date);
    };

    /** Corte de un día pasado: cierra el pendiente sin tocar las ventas de hoy. */
    const openRetroShift = (): void => {
      openModal({
        title: "Corte de otro día",
        content: html`
          <p class="hint">Cierra el corte de un día que se te quedó pendiente. Queda fechado al final de ese día y las ventas de hoy no se tocan.</p>
          <label class="form-field">Día del corte
            <input id="retroDay" class="input" type="date" value="${yesterdayValue()}" max="${yesterdayValue()}">
          </label>
          <div id="retroPreview" class="summary"></div>
          <div class="row">
            <label class="form-field">Efectivo contado (vacío = esperado)
              <input id="retroCounted" class="input" type="number" step="0.01" min="0" inputmode="decimal" placeholder="0.00">
            </label>
            <label class="form-field">Notas
              <input id="retroNotes" class="input" placeholder="Ej. cierre pendiente de ayer">
            </label>
          </div>
        `,
        actions: [
          { label: "Cancelar", kind: "ghost" },
          {
            label: "Cerrar corte del día",
            kind: "primary",
            onClick: (close) => {
              const dayInput = document.querySelector<HTMLInputElement>("#retroDay");
              const countedInput = document.querySelector<HTMLInputElement>("#retroCounted");
              const notesInput = document.querySelector<HTMLInputElement>("#retroNotes");
              const day = dayInput?.value ?? "";
              if (!day || day >= todayInputValue()) {
                ctx.toast("Elige un día anterior a hoy");
                return;
              }
              const info = ctx.shifts.dayInfo(branchId(), day);
              const base = ctx.shifts.lastShiftBefore(branchId(), info.end)?.next_opening_cash ?? 0;
              const expected = toPesos(toCents(base) + toCents(info.summary.efectivoEsperado));
              const countedValue = (countedInput?.value ?? "").trim() === "" ? expected : Number(countedInput!.value);
              const result = ctx.shifts.closeDay(day, {
                opening_cash: base,
                counted_cash: countedValue,
                withdrawn_cash: 0,
                next_opening_cash: base,
                notes: (notesInput?.value ?? "").trim() || "Corte de un día pendiente"
              });
              if (!result.ok) {
                ctx.toast(result.error);
                return;
              }
              close();
              ctx.toast(`Corte del ${day} cerrado: ${fmtMoneyPesos(result.shift.summary.ventas)} en ventas`);
              historyPage = 0;
              renderAll();
            }
          }
        ],
        onOpen: (modalRoot) => {
          const dayInput = modalRoot.querySelector<HTMLInputElement>("#retroDay")!;
          const countedInput = modalRoot.querySelector<HTMLInputElement>("#retroCounted")!;
          const preview = modalRoot.querySelector<HTMLElement>("#retroPreview")!;
          const renderPreview = (): void => {
            const day = dayInput.value || yesterdayValue();
            const info = ctx.shifts.dayInfo(branchId(), day);
            if (info.alreadyClosed || info.start >= info.end) {
              setHtml(preview, html`<p class="muted">Ese día ya tiene un corte cerrado.</p>`);
              return;
            }
            const s = info.summary;
            if (!summaryHasActivity(s)) {
              setHtml(preview, html`<p class="muted">Ese día no tuvo movimientos.</p>`);
              return;
            }
            const base = ctx.shifts.lastShiftBefore(branchId(), info.end)?.next_opening_cash ?? 0;
            const expected = toPesos(toCents(base) + toCents(s.efectivoEsperado));
            const countedValue = countedInput.value.trim() === "" ? null : Number(countedInput.value);
            const difference = countedValue === null ? null : toPesos(toCents(countedValue) - toCents(expected));
            setHtml(
              preview,
              html`
                <div><span>Base inicial</span><strong>${fmtMoneyPesos(base)}</strong></div>
                <div class="row-strong"><span>Ventas del día</span><strong>${fmtMoneyPesos(s.ventas)}</strong></div>
                <div><span>Efectivo esperado con base</span><strong>${fmtMoneyPesos(expected)}</strong></div>
                <div><span>Diferencia con lo contado</span><strong>${difference === null ? "—" : fmtMoneyPesos(difference)}</strong></div>
              `
            );
          };
          dayInput.addEventListener("input", renderPreview);
          countedInput.addEventListener("input", renderPreview);
          renderPreview();
        }
      });
    };

    root.querySelector<HTMLButtonElement>("#closeShift")!.addEventListener("click", async () => {
      const summary = ctx.shifts.summarize(branchId());
      const pending = ctx.store.getState().sync.pending;
      // Cerrar con ventas offline pendientes deja el efectivo esperado
      // incompleto y produce un sobrante/faltante falso. Se avisa y se pide
      // confirmación explícita; la tienda puede seguir vendiendo sin red.
      if (pending > 0) {
        const proceed = await confirmDialog({
          title: "Hay cambios sin sincronizar",
          message: `Quedan ${pending} cambio(s) por subir. El efectivo esperado puede no incluir ventas de este u otros equipos. Conecta y espera a "Todo sincronizado" antes de cerrar. ¿Cerrar de todos modos?`,
          confirmLabel: "Cerrar de todos modos",
          danger: true
        });
        if (!proceed) return;
      } else {
        const confirmed = await confirmDialog({
          title: "Cerrar corte",
          message: `Ventas: ${fmtMoneyPesos(summary.ventas)} | Efectivo esperado: ${fmtMoneyPesos(summary.efectivoEsperado)}. Se cerrará el corte de esta sucursal.`,
          confirmLabel: "Cerrar corte"
        });
        if (!confirmed) return;
      }
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
      historyPage = 0;
      renderAll();
    });

    root.querySelector<HTMLButtonElement>("#retroShift")!.addEventListener("click", openRetroShift);

    root.querySelector<HTMLButtonElement>("#sendWhatsapp")!.addEventListener("click", () => {
      const last = ctx.shifts.lastShift(branchId());
      if (!last) {
        ctx.toast("Primero cierra un corte");
        return;
      }
      sendShift(last);
    });

    historyEl.addEventListener("click", (event) => {
      const paging = pagerClick(event);
      if (paging) {
        historyPage = paging.page;
        renderHistory();
        return;
      }
      const button = (event.target as HTMLElement).closest<HTMLElement>("[data-shift]");
      if (!button) return;
      const shift = ctx.repos.shifts.byId(button.dataset.shift ?? "");
      if (shift) openShiftDetail(shift);
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
