import { monthInputValue } from "../../../core/dates";
import { html, setHtml } from "../../../core/html";
import { VIEW_ALL } from "../../../domain/app-state";
import { lazyRender } from "../../lazy-render";
import type { TabModule } from "../tab-module";
import { renderGoals, renderHero, renderMonth, renderWeek } from "./cards";
import { createRankCard, renderCredit, renderLow, renderVendorPayments } from "./lists";
import { createInicioScene, type InicioScene } from "./scene";

/** Saludo y fecha del encabezado. */
function renderGreeting(scene: InicioScene, isManager: boolean, isOwner: boolean): void {
  const { ctx, ui } = scene;
  const hour = new Date().getHours();
  const saludo = hour < 12 ? "Buenos días" : hour < 19 ? "Buenas tardes" : "Buenas noches";
  const firstName = ctx.auth.displayName();
  const date = new Date().toLocaleDateString("es-MX", { weekday: "long", day: "numeric", month: "long" });
  const sub = isOwner ? "Resumen de tu negocio" : isManager ? "Operación de la sucursal" : "Tus ventas de hoy";
  setHtml(ui.greetingEl, html`<h2>${saludo}${firstName ? `, ${firstName}` : ""}</h2><p class="hint dash-date">${date} · ${sub}</p>`);
}

export const inicioTab: TabModule = {
  id: "inicio",
  render(root, ctx) {
    const scene = createInicioScene(root, ctx);
    const { ui } = scene;
    const managerOnly = [ui.weekCard, ui.monthCard, ui.rankCard, ui.lowCard, ui.creditCard];
    const rank = createRankCard(scene);

    const render = (): void => {
      const scope = ctx.branches.viewScope();
      const isManager = ctx.auth.isAdmin();
      renderGreeting(scene, isManager, ctx.auth.isOwner());
      managerOnly.forEach((card) => card.classList.toggle("hidden", !isManager));
      setHtml(
        ui.scopeChips,
        isManager && ctx.branches.canSwitch()
          ? html`<div class="chips">${[...ctx.branches.list().map((b) => ({ id: b.id, label: b.name })), { id: VIEW_ALL, label: "Todas" }].map(
              (chip) => html`<button class="chip ${scope === chip.id ? "chip-active" : ""}" type="button" data-scope="${chip.id}">${chip.label}</button>`
            )}</div>`
          : html``
      );

      const today = scene.dayReport(scope, 0);
      const monthReport = ctx.reports.monthReport(scope, monthInputValue());
      renderHero(scene, scope, today, monthReport, isManager);
      if (!isManager) {
        renderVendorPayments(scene, scope);
        return;
      }
      renderGoals(scene, scope, today, monthReport);
      renderWeek(scene, scope, monthReport);
      renderMonth(scene, scope, monthReport);
      rank.renderRank(scope);
      renderLow(scene, scope);
      renderCredit(scene, scope);
    };

    const schedule = lazyRender(root, render);

    ui.scopeChips.addEventListener("click", (event) => {
      const chip = (event.target as HTMLElement).closest<HTMLElement>("[data-scope]");
      if (!chip) return;
      ctx.branches.setViewScope(chip.dataset.scope ?? VIEW_ALL);
    });

    // Las gráficas por hora cambian con el reloj: se redibuja cada 5 minutos
    window.setInterval(schedule, 5 * 60_000);

    ctx.store.watch(
      (s) => [s.sales, s.returns, s.expenses, s.purchases, s.products, s.product_stocks, s.customers, s.shifts, s.branches, s.viewBranchId, s.settings] as const,
      schedule
    );
  }
};
