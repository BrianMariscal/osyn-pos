/**
 * Ticket de venta: folio, cálculo de cambio y texto del comprobante.
 */
import { fmtMoney, lineTotalCents, toCents } from "../core/money";
import { fmtQty } from "../core/qty";
import { PAYMENT_LABELS, type Sale, type SaleItem, type SaleReturn } from "../core/types";

/** Folio legible y estable: AAMMDD-XXXX (fecha local + final del id). */
export function saleFolio(sale: Pick<Sale, "id" | "created_at">): string {
  const date = new Date(sale.created_at);
  const pad = (n: number) => String(n).padStart(2, "0");
  const day = Number.isFinite(date.getTime()) ? `${String(date.getFullYear()).slice(2)}${pad(date.getMonth() + 1)}${pad(date.getDate())}` : "000000";
  const tail = sale.id.replace(/[^a-zA-Z0-9]/g, "").slice(-4).toUpperCase().padStart(4, "0");
  return `${day}-${tail}`;
}

export type CashCheck =
  | { status: "empty" }
  | { status: "short"; missingCents: number }
  | { status: "ok"; changeCents: number };

/** Compara lo que entrega el cliente contra el total (en centavos). */
export function cashChange(totalCents: number, received: string | number): CashCheck {
  const raw = typeof received === "number" ? received : Number(String(received).replace(/[$,\s]/g, ""));
  if (String(received).trim() === "" || !Number.isFinite(raw) || raw <= 0) return { status: "empty" };
  const receivedCents = toCents(raw);
  if (receivedCents < totalCents) return { status: "short", missingCents: totalCents - receivedCents };
  return { status: "ok", changeCents: receivedCents - totalCents };
}

/** Billetes sugeridos para cobrar: los que alcanzan a cubrir el total. */
export function quickCashOptions(totalCents: number): number[] {
  const bills = [20, 50, 100, 200, 500, 1000];
  const total = totalCents / 100;
  const options = bills.filter((bill) => bill > total);
  // Siguiente múltiplo de 10/50 por si paga "redondeado"
  const round10 = Math.ceil(total / 10) * 10;
  if (round10 > total && !options.includes(round10)) options.unshift(round10);
  return [...new Set(options)].sort((a, b) => a - b).slice(0, 4);
}

export function itemLabel(item: SaleItem): string {
  return item.pack_size
    ? `${fmtQty(item.qty)} ${item.qty === 1 ? "caja" : "cajas"} (${fmtQty(item.qty * item.pack_size)} ${item.um})`
    : `${fmtQty(item.qty)} ${item.um}`;
}

export function saleTotalCents(sale: Sale): number {
  return sale.items.reduce((sum, item) => sum + lineTotalCents(item.qty, item.price), 0);
}

/** Texto del ticket (para el mensaje de WhatsApp que acompaña la imagen). */
export function ticketText(sale: Sale, storeName: string, branchName = ""): string {
  const date = new Date(sale.created_at).toLocaleString("es-MX", { dateStyle: "short", timeStyle: "short" });
  const lines = [
    `*${storeName}*${branchName ? ` · ${branchName}` : ""}`,
    `Ticket ${saleFolio(sale)} · ${date}`,
    "",
    ...sale.items.map((item) => `${itemLabel(item)} ${item.name} — ${fmtMoney(lineTotalCents(item.qty, item.price))}`),
    "",
    `*Total: ${fmtMoney(saleTotalCents(sale))}*`,
    `Pago: ${PAYMENT_LABELS[sale.payment]}`
  ];
  if (sale.cash_received) lines.push(`Pagó con: ${fmtMoney(toCents(sale.cash_received))}`, `Cambio: ${fmtMoney(toCents(sale.change ?? 0))}`);
  lines.push("", "¡Gracias por su compra!");
  return lines.join("\n");
}

/** Folio de la nota de devolución: D-AAMMDD-XXXX (mismo día + final del id). */
export function returnFolio(ret: Pick<SaleReturn, "id" | "created_at">): string {
  return `D-${saleFolio(ret)}`;
}

export function returnTotalCents(ret: SaleReturn): number {
  return (ret.items ?? []).reduce((sum, item) => sum + lineTotalCents(item.qty, item.price), 0);
}
