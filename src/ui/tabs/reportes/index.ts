import type { TabModule } from "../tab-module";
import { createReportesScene } from "./scene";
import { mountSalesDay } from "./sales-day";
import { mountReports } from "./reports";

export const reportesTab: TabModule = {
  id: "reportes",
  render(root, ctx) {
    const scene = createReportesScene(root, ctx);
    const { renderSalesDay } = mountSalesDay(scene);
    const { renderReports } = mountReports(scene);

    ctx.store.watch(
      (s) => [s.sales, s.returns, s.expenses, s.purchases, s.mermas, s.month_closings, s.branches, s.viewBranchId, s.shifts] as const,
      () => {
        renderReports();
        renderSalesDay();
      }
    );
    renderReports();
  }
};
