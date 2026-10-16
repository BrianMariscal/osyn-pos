import { fmtMoney, toCents } from "../../core/money";
import { fmtQty } from "../../core/qty";
import { type Sale, type SaleReturn, type SaleReturnItem } from "../../core/types";
import type { AppContext } from "../context";

export interface DocInfo {
  store: string;
  branch: string;
  logo: string;
  customer: string;
}

export function infoFor(ctx: AppContext, sale: Sale): DocInfo {
  const settings = ctx.store.getState().settings;
  return {
    store: settings.storeName || "Mi tienda",
    branch: ctx.branches.isMultiBranch() ? ctx.branches.name(sale.branch_id) : "",
    logo: settings.logo,
    customer: sale.customer_id ? ctx.repos.customers.byId(sale.customer_id)?.name ?? "" : ""
  };
}

export function returnInfoFor(ctx: AppContext, ret: SaleReturn): DocInfo {
  const settings = ctx.store.getState().settings;
  const sale = ctx.repos.sales.byId(ret.sale_id);
  return {
    store: settings.storeName || "Mi tienda",
    branch: sale && ctx.branches.isMultiBranch() ? ctx.branches.name(sale.branch_id) : "",
    logo: settings.logo,
    customer: ret.customer_id ? ctx.repos.customers.byId(ret.customer_id)?.name ?? "" : ""
  };
}

export function dateLabel(iso: string): string {
  return new Date(iso).toLocaleString("es-MX", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

export function returnItemLabel(item: SaleReturnItem): string {
  const qty = item.pack_size
    ? `${fmtQty(item.qty)} ${item.qty === 1 ? "caja" : "cajas"} (${fmtQty(item.qty * item.pack_size)} ${item.um})`
    : `${fmtQty(item.qty)} ${item.um}`;
  return `${qty} × ${fmtMoney(toCents(item.price))}`;
}
