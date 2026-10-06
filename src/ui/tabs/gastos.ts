import { html, setHtml } from "../../core/html";
import { fmtDate, fmtDateTime } from "../../core/dates";
import { fmtMoney, fmtMoneyPesos } from "../../core/money";
import { EXPENSE_CATEGORIES, type Expense, type ExpensePeriod } from "../../core/types";
import { daysInMonth, expensePeriod } from "../../domain/expense-service";
import { confirmDialog, openModal } from "../components/modal";
import { iconFor } from "../icons";
import { mountSections } from "../sections";
import type { TabModule } from "./tab-module";

/** Categorías sugeridas para costos fijos mensuales. */
const FIXED_CATEGORIES = ["Renta", "Luz", "Agua", "Gas", "Internet", "Sueldos", "Impuestos", "Varios"] as const;

export const gastosTab: TabModule = {
  id: "gastos",
  render(root, ctx) {
    setHtml(
      root,
      html`
        <div class="split">
          <article class="card">
            <h2>Costos fijos (semanales y mensuales)</h2>
            <p class="hint">Registra lo que pagas cada semana (sueldos, gas…) o cada mes (renta, luz…). El sistema calcula cuánto necesitas generar al día para cubrirlo y lo muestra en Inicio.</p>
            <div id="fixedTarget" class="target-box"></div>
            <form id="fixedForm" class="form fixed-form">
              <label class="form-field">Concepto
                <input id="fixedConcept" class="input" placeholder="Ej. Renta del local" required>
              </label>
              <label class="form-field">Monto
                <input id="fixedAmount" class="input" type="number" step="0.01" min="0.01" inputmode="decimal" placeholder="0.00" required>
              </label>
              <label class="form-field">Frecuencia
                <select id="fixedPeriod" class="input">
                  <option value="mensual">Mensual</option>
                  <option value="semanal">Semanal</option>
                </select>
              </label>
              <label class="form-field">Categoría
                <select id="fixedCategory" class="input">
                  ${FIXED_CATEGORIES.map((category) => html`<option>${category}</option>`)}
                </select>
              </label>
              <button class="primary" type="submit">${iconFor("plus")} Agregar</button>
            </form>
            <div id="fixedList" class="list"></div>
          </article>

          <article class="card">
            <h2>Gastos extra del día</h2>
            <p class="hint">Pagos imprevistos que salen de la caja (se descuentan del efectivo esperado en el corte).</p>
            <form id="expenseForm" class="form">
              <input id="expenseConcept" class="input" placeholder="Concepto" aria-label="Concepto" required>
              <div class="row">
                <input id="expenseAmount" class="input" type="number" step="0.01" min="0.01" inputmode="decimal" placeholder="Monto" aria-label="Monto" required>
                <select id="expenseCategory" class="input" aria-label="Categoría">
                  ${EXPENSE_CATEGORIES.map((category) => html`<option ${category === "Varios" ? "selected" : null}>${category}</option>`)}
                </select>
              </div>
              <button class="ghost" type="submit">Registrar gasto extra</button>
            </form>
            <div id="expensesList" class="list"></div>
          </article>
        </div>
      `
    );

    // En celular: una sección a la vez (en computadora van lado a lado)
    const articles = [...root.querySelectorAll<HTMLElement>(":scope > .split > article")];
    mountSections(root, [
      { id: "fijos", label: "Costos fijos", el: articles[0] ?? null },
      { id: "extra", label: "Gastos del día", el: articles[1] ?? null }
    ]);

    const fixedForm = root.querySelector<HTMLFormElement>("#fixedForm")!;
    const fixedConcept = root.querySelector<HTMLInputElement>("#fixedConcept")!;
    const fixedAmount = root.querySelector<HTMLInputElement>("#fixedAmount")!;
    const fixedCategory = root.querySelector<HTMLSelectElement>("#fixedCategory")!;
    const fixedPeriod = root.querySelector<HTMLSelectElement>("#fixedPeriod")!;
    const fixedList = root.querySelector<HTMLElement>("#fixedList")!;
    const fixedTarget = root.querySelector<HTMLElement>("#fixedTarget")!;
    const form = root.querySelector<HTMLFormElement>("#expenseForm")!;
    const concept = root.querySelector<HTMLInputElement>("#expenseConcept")!;
    const amount = root.querySelector<HTMLInputElement>("#expenseAmount")!;
    const category = root.querySelector<HTMLSelectElement>("#expenseCategory")!;
    const list = root.querySelector<HTMLElement>("#expensesList")!;

    const expenseRow = (expense: Expense, fixed: boolean) => html`
      <div class="list-item item-line">
        <div>
          <strong>${expense.concept}</strong>
          <p class="muted">${fixed ? `${expensePeriod(expense) === "semanal" ? "Semanal" : "Mensual"} · ` : ""}${expense.category} | ${fixed ? `Desde ${fmtDate(expense.created_at)}` : fmtDateTime(expense.created_at)}</p>
        </div>
        <div class="row-end">
          <strong>${fmtMoneyPesos(expense.amount)}${fixed ? html`<small class="muted"> /${expensePeriod(expense) === "semanal" ? "semana" : "mes"}</small>` : html``}</strong>
          <div class="icon-actions">
            <button class="icon-btn" type="button" data-edit-expense="${expense.id}" aria-label="Editar ${expense.concept}" title="Editar">${iconFor("edit")}</button>
            <button class="icon-btn danger" type="button" data-delete-expense="${expense.id}" aria-label="Eliminar ${expense.concept}" title="Eliminar">${iconFor("trash")}</button>
          </div>
        </div>
      </div>
    `;

    const render = (): void => {
      const fixed = ctx.expenses.fixedCosts();
      const monthly = ctx.expenses.monthlyFixedCents();
      const daily = ctx.expenses.dailyTargetCents();
      const parts = ctx.expenses.fixedBreakdown();
      const days = daysInMonth(new Date());
      const breakdown = [
        parts.monthly > 0 ? `${fmtMoney(parts.monthly)} mensual ÷ ${days} días` : "",
        parts.weekly > 0 ? `${fmtMoney(parts.weekly)} semanal ÷ 7 días` : ""
      ].filter(Boolean).join(" + ");
      setHtml(
        fixedTarget,
        monthly > 0
          ? html`
              <div><span class="micro">Equivale al mes</span><strong>${fmtMoney(monthly)}</strong></div>
              <div><span class="micro">Necesitas al día</span><strong>${fmtMoney(daily)}</strong></div>
              <p class="hint">${breakdown}, en ganancia (venta menos costo).</p>
            `
          : html`<p class="hint">Aún no hay costos fijos. Agrega el primero para ver tu meta diaria.</p>`
      );
      setHtml(
        fixedList,
        fixed.length
          ? html`${fixed.map((expense) => expenseRow(expense, true))}`
          : html`<p class="muted">Sin costos fijos registrados.</p>`
      );
      const extras = ctx.expenses.extras().slice(0, 30);
      setHtml(
        list,
        extras.length
          ? html`${extras.map((expense) => expenseRow(expense, false))}`
          : html`<p class="muted">Sin gastos extra registrados.</p>`
      );
    };

    fixedForm.addEventListener("submit", (event) => {
      event.preventDefault();
      const result = ctx.expenses.add("fijo", fixedConcept.value, Number(fixedAmount.value || 0), fixedCategory.value, fixedPeriod.value as ExpensePeriod);
      if (!result.ok) {
        ctx.toast(result.error);
        return;
      }
      fixedForm.reset();
      ctx.toast("Costo fijo agregado");
      fixedConcept.focus();
    });

    form.addEventListener("submit", (event) => {
      event.preventDefault();
      const result = ctx.expenses.add("extra", concept.value, Number(amount.value || 0), category.value);
      if (!result.ok) {
        ctx.toast(result.error);
        return;
      }
      form.reset();
      category.value = "Varios";
      ctx.toast("Gasto registrado");
    });

    const openEdit = (expense: Expense): void => {
      const fixed = expense.kind === "fijo";
      const categories: readonly string[] = fixed ? FIXED_CATEGORIES : EXPENSE_CATEGORIES;
      const options = categories.includes(expense.category) ? categories : [expense.category, ...categories];
      openModal({
        title: fixed ? "Editar costo fijo" : "Editar gasto",
        content: html`
          <label class="form-field">Concepto
            <input id="eConcept" class="input" value="${expense.concept}">
          </label>
          <div class="row">
            <label class="form-field">Monto
              <input id="eAmount" class="input" type="number" step="0.01" min="0.01" inputmode="decimal" value="${expense.amount}">
            </label>
            <label class="form-field">Categoría
              <select id="eCategory" class="input">
                ${options.map((option) => html`<option ${option === expense.category ? "selected" : null}>${option}</option>`)}
              </select>
            </label>
          </div>
          ${fixed
            ? html`<label class="form-field">Frecuencia
                <select id="ePeriod" class="input">
                  <option value="mensual" ${expensePeriod(expense) === "mensual" ? "selected" : null}>Mensual</option>
                  <option value="semanal" ${expensePeriod(expense) === "semanal" ? "selected" : null}>Semanal</option>
                </select>
              </label>`
            : html``}
        `,
        actions: [
          { label: "Cancelar", kind: "ghost", onClick: (close) => close() },
          {
            label: "Guardar",
            kind: "primary",
            onClick: (close) => {
              const result = ctx.expenses.update(expense.id, {
                concept: (document.getElementById("eConcept") as HTMLInputElement).value,
                amount: Number((document.getElementById("eAmount") as HTMLInputElement).value || 0),
                category: (document.getElementById("eCategory") as HTMLSelectElement).value,
                period: fixed ? ((document.getElementById("ePeriod") as HTMLSelectElement).value as ExpensePeriod) : undefined
              });
              if (!result.ok) {
                ctx.toast(result.error);
                return;
              }
              close();
              ctx.toast("Gasto actualizado");
            }
          }
        ]
      });
    };

    root.addEventListener("click", async (event) => {
      const target = event.target as HTMLElement;
      const editButton = target.closest<HTMLElement>("[data-edit-expense]");
      if (editButton) {
        const expense = ctx.repos.expenses.byId(editButton.dataset.editExpense!);
        if (expense && !expense.deleted) openEdit(expense);
        return;
      }
      const deleteButton = target.closest<HTMLElement>("[data-delete-expense]");
      if (!deleteButton) return;
      const expense = ctx.repos.expenses.byId(deleteButton.dataset.deleteExpense!);
      if (!expense || expense.deleted) return;
      const fixed = expense.kind === "fijo";
      const confirmed = await confirmDialog({
        title: fixed ? "Eliminar costo fijo" : "Eliminar gasto",
        message: fixed
          ? `Se eliminará "${expense.concept}" (${fmtMoneyPesos(expense.amount)} ${expensePeriod(expense) === "semanal" ? "a la semana" : "al mes"}) y dejará de contar en la meta diaria.`
          : `Se eliminará "${expense.concept}" por ${fmtMoneyPesos(expense.amount)}. El corte y los reportes se recalculan.`,
        confirmLabel: "Eliminar",
        danger: true
      });
      if (!confirmed) return;
      const result = ctx.expenses.remove(expense.id);
      ctx.toast(result.ok ? "Gasto eliminado" : result.error);
    });

    ctx.store.watch((s) => [s.expenses, s.branches, s.currentBranchId] as const, render);
  }
};
