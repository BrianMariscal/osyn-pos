import { html, setHtml } from "../../core/html";
import { fmtDateTime, nowISO } from "../../core/dates";
import { uid } from "../../core/id";
import { fmtMoneyPesos } from "../../core/money";
import { EXPENSE_CATEGORIES } from "../../core/types";
import type { TabModule } from "./tab-module";

export const gastosTab: TabModule = {
  id: "gastos",
  render(root, ctx) {
    setHtml(
      root,
      html`
        <article class="card">
          <h2>Control de gastos</h2>
          <form id="expenseForm" class="form inline-form">
            <input id="expenseConcept" class="input" placeholder="Concepto" required>
            <input id="expenseAmount" class="input" type="number" step="0.01" min="0" placeholder="Monto" required>
            <select id="expenseCategory" class="input">
              ${EXPENSE_CATEGORIES.map((category) => html`<option>${category}</option>`)}
            </select>
            <button class="primary" type="submit">Registrar</button>
          </form>
          <div id="expensesList" class="list"></div>
        </article>
      `
    );

    const form = root.querySelector<HTMLFormElement>("#expenseForm")!;
    const concept = root.querySelector<HTMLInputElement>("#expenseConcept")!;
    const amount = root.querySelector<HTMLInputElement>("#expenseAmount")!;
    const category = root.querySelector<HTMLSelectElement>("#expenseCategory")!;
    const list = root.querySelector<HTMLElement>("#expensesList")!;

    const render = (): void => {
      const branchId = ctx.branches.operationalId();
      const expenses = ctx.repos.expenses
        .list()
        .filter((expense) => expense.branch_id === branchId)
        .slice(0, 30);
      setHtml(
        list,
        expenses.length
          ? html`${expenses.map(
              (expense) => html`
                <div class="list-item item-line">
                  <div>
                    <strong>${expense.concept}</strong>
                    <p class="muted">${expense.category} | ${fmtDateTime(expense.created_at)}</p>
                  </div>
                  <strong>${fmtMoneyPesos(expense.amount)}</strong>
                </div>
              `
            )}`
          : html`<p class="muted">Sin gastos registrados.</p>`
      );
    };

    form.addEventListener("submit", (event) => {
      event.preventDefault();
      const ts = nowISO();
      ctx.repos.expenses.upsert({
        id: uid(),
        branch_id: ctx.branches.operationalId(),
        concept: concept.value.trim(),
        amount: Math.round(Number(amount.value || 0) * 100) / 100,
        category: category.value,
        created_at: ts,
        updated_at: ts
      });
      form.reset();
      ctx.toast("Gasto registrado");
    });

    ctx.store.watch(
      (s) => [s.expenses, s.branches, s.currentBranchId] as const,
      render
    );
    render();
  }
};
