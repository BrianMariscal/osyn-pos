import { html, setHtml } from "../../core/html";
import { sumCents, toCents, toPesos, fmtMoneyPesos } from "../../core/money";
import { isRevenueSale } from "../../domain/sale-groups";
import type { AppContext } from "../context";
import { applyFavicon, rememberBrand, rememberedBrand, showLogo } from "./brand";
import { renderTabsNav } from "./nav";
import { syncStatus } from "./sync";
import { applyTheme } from "./theme";

const PRODUCT_NAME = "OSYN POS";

export function wireTopbar(ctx: AppContext): void {
  const branchSelect = document.getElementById("branchSelect") as HTMLSelectElement;
  branchSelect.addEventListener("change", () => {
    ctx.branches.setOperational(branchSelect.value);
  });

  document.getElementById("topLogoutButton")?.addEventListener("click", () => {
    void ctx.auth.logout().then(() => window.location.reload());
  });

  ctx.store.watch((s) => s.settings, (settings) => {
    // Con sesión se recuerda la marca en el dispositivo; sin sesión (login)
    // se usa la recordada, porque los ajustes del invitado vienen vacíos.
    if (ctx.auth.isAuthenticated) rememberBrand(settings.storeName, settings.logo);
    const brand = ctx.auth.isAuthenticated ? { name: settings.storeName, logo: settings.logo } : rememberedBrand(settings.storeName, settings.logo);
    const name = brand.name || PRODUCT_NAME;
    // La pestaña y el login muestran la marca del producto; el nombre de la
    // tienda acompaña en la pestaña para no perder el contexto de la sucursal.
    document.title = name === PRODUCT_NAME ? PRODUCT_NAME : `${name} · ${PRODUCT_NAME}`;
    const title = document.getElementById("appTitle");
    if (title) title.textContent = name;
    const loginTitle = document.getElementById("loginTitle");
    if (loginTitle) loginTitle.textContent = PRODUCT_NAME;
    showLogo("loginLogo", "loginMark", brand.logo, PRODUCT_NAME);
    showLogo("storeLogo", "brandMark", brand.logo, name);
    applyFavicon(brand.logo);
    applyTheme(ctx);
    renderTabsNav(ctx);
  });

  const renderSyncDot = (): void => {
    const status = syncStatus(ctx);
    const dot = document.getElementById("syncDot");
    const button = document.getElementById("sessionButton");
    if (dot) dot.dataset.state = status.state;
    if (button) button.title = `${status.label}${status.detail ? ` · ${status.detail}` : ""}`;
  };
  ctx.store.watch((s) => s.sync, renderSyncDot);
  window.addEventListener("online", renderSyncDot);
  window.addEventListener("offline", renderSyncDot);
  // Tema automático: sigue al sistema si cambia mientras la app está abierta
  window.matchMedia?.("(prefers-color-scheme: dark)").addEventListener?.("change", () => applyTheme(ctx));

  ctx.store.watch(
    (s) => [s.sales, s.returns, s.branches, s.currentBranchId] as const,
    () => {
      const branchId = ctx.branches.operationalId();
      const start = new Date();
      start.setHours(0, 0, 0, 0);
      const end = new Date(start);
      end.setDate(end.getDate() + 1);
      const startISO = start.toISOString();
      const endISO = end.toISOString();
      let totalCents = sumCents(
        ctx.repos.sales
          .list()
          .filter((sale) => sale.branch_id === branchId && isRevenueSale(sale) && sale.created_at >= startISO && sale.created_at < endISO)
          .map((sale) => toCents(sale.total))
      );
      // Las devoluciones de hoy bajan el total del pill "Hoy".
      totalCents -= sumCents(
        ctx.repos.returns
          .list()
          .filter((ret) => ret.branch_id === branchId && ret.created_at >= startISO && ret.created_at < endISO)
          .map((ret) => toCents(ret.total))
      );
      const el = document.getElementById("todayTotal");
      if (el) el.textContent = fmtMoneyPesos(toPesos(totalCents));
    }
  );

  ctx.store.watch(
    (s) => [s.branches, s.currentBranchId] as const,
    () => {
      const assigned = ctx.auth.isAuthenticated ? ctx.auth.assignedBranchId() : null;
      const isAdmin = ctx.auth.isAuthenticated ? ctx.auth.isAdmin() : false;
      const badge = document.getElementById("branchBadge");
      // Vendedor o administrador asignado a una sucursal: solo la suya, sin selector
      if (!isAdmin || assigned) {
        branchSelect.classList.add("hidden");
        const branchId = assigned;
        if (badge) {
          badge.textContent = branchId ? ctx.branches.name(branchId) : "Sin sucursal";
          badge.classList.remove("hidden");
        }
        return;
      }
      if (badge) badge.classList.add("hidden");
      const branches = ctx.branches.list();
      // Con una sola sucursal no hay nada que elegir: se oculta el selector.
      branchSelect.classList.toggle("hidden", branches.length <= 1);
      setHtml(
        branchSelect,
        html`${branches.map((branch) => html`<option value="${branch.id}">${branch.name}</option>`)}`
      );
      branchSelect.value = ctx.branches.operationalId();
    }
  );
}
