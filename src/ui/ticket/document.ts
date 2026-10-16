import { fmtMoney, lineTotalCents, toCents } from "../../core/money";
import { PAYMENT_LABELS, REFUND_LABELS, type Sale, type SaleReturn } from "../../core/types";
import { itemLabel, returnFolio, returnTotalCents, saleFolio, saleTotalCents } from "../../domain/ticket";
import type { AppContext } from "../context";
import { dateLabel, infoFor, returnInfoFor, returnItemLabel, type DocInfo } from "./info";

function loadImage(src: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    if (!src) return resolve(null);
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

interface DocRow {
  label: string;
  value: string;
  size?: number;
  weight?: number;
  color?: string;
}

/** Contenido del comprobante, igual para ticket y nota de devolución. */
interface PrintableDoc {
  info: DocInfo;
  /** Línea extra bajo el nombre de la tienda (p. ej. "Nota de devolución"). */
  headline: string;
  /** Primera fila en negrita (folio). */
  meta: Array<[string, string]>;
  items: Array<{ name: string; detail: string; amount: string }>;
  totalLabel: string;
  total: string;
  rows: DocRow[];
  footer: string;
}

/** Imagen PNG del comprobante (ancho de ticket de 80 mm, a doble resolución). */
async function documentImage(doc: PrintableDoc): Promise<Blob> {
  const logo = await loadImage(doc.info.logo);
  const W = 420;
  const pad = 26;
  const scale = 2;
  const font = (size: number, weight = 400) => `${weight} ${size}px "Segoe UI", system-ui, -apple-system, Roboto, sans-serif`;
  const measure = document.createElement("canvas").getContext("2d")!;

  const wrap = (text: string, size: number, weight: number, width: number): string[] => {
    measure.font = font(size, weight);
    const words = text.split(/\s+/);
    const lines: string[] = [];
    let line = "";
    for (const word of words) {
      const next = line ? `${line} ${word}` : word;
      if (measure.measureText(next).width > width && line) {
        lines.push(line);
        line = word;
      } else line = next;
    }
    if (line) lines.push(line);
    return lines;
  };

  // Primero se calcula el alto, luego se dibuja
  const ops: Array<(c: CanvasRenderingContext2D, y: number) => number> = [];
  const text = (value: string, size: number, weight = 400, align: CanvasTextAlign = "left", color = "#17202a") =>
    ops.push((c, y) => {
      c.font = font(size, weight);
      c.fillStyle = color;
      c.textAlign = align;
      c.fillText(value, align === "center" ? W / 2 : align === "right" ? W - pad : pad, y + size);
      return size + 6;
    });
  const row = (left: string, right: string, size: number, weight = 400, color = "#17202a") =>
    ops.push((c, y) => {
      c.font = font(size, weight);
      c.fillStyle = color;
      c.textAlign = "left";
      c.fillText(left, pad, y + size);
      c.textAlign = "right";
      c.fillText(right, W - pad, y + size);
      return size + 8;
    });
  const gap = (h: number) => ops.push(() => h);
  const dashed = () =>
    ops.push((c, y) => {
      c.strokeStyle = "#9aa5b1";
      c.setLineDash([5, 4]);
      c.beginPath();
      c.moveTo(pad, y + 6);
      c.lineTo(W - pad, y + 6);
      c.stroke();
      c.setLineDash([]);
      return 14;
    });

  if (logo) {
    const maxW = 180;
    const maxH = 80;
    const ratio = Math.min(maxW / logo.naturalWidth, maxH / logo.naturalHeight, 1);
    const w = logo.naturalWidth * ratio;
    const h = logo.naturalHeight * ratio;
    ops.push((c, y) => {
      c.drawImage(logo, (W - w) / 2, y, w, h);
      return h + 10;
    });
  }
  wrap(doc.info.store, 22, 800, W - pad * 2).forEach((line) => text(line, 22, 800, "center"));
  if (doc.info.branch) text(doc.info.branch, 14, 400, "center", "#546374");
  if (doc.headline) {
    gap(4);
    text(doc.headline, 15, 800, "center");
  }
  gap(6);
  dashed();
  doc.meta.forEach(([label, value], index) => row(label, value, 14, index === 0 ? 600 : 400));
  dashed();
  for (const item of doc.items) {
    wrap(item.name, 16, 700, W - pad * 2).forEach((line) => text(line, 16, 700));
    row(item.detail, item.amount, 14, 400, "#3d4a57");
    gap(2);
  }
  dashed();
  row(doc.totalLabel, doc.total, 24, 800);
  gap(4);
  for (const item of doc.rows) row(item.label, item.value, item.size ?? 15, item.weight ?? 400, item.color ?? "#17202a");
  dashed();
  gap(4);
  text(doc.footer, 16, 700, "center");
  gap(10);

  let height = pad;
  const probe = document.createElement("canvas").getContext("2d")!;
  for (const op of ops) height += op(probe, -10_000);
  height += pad;

  const canvas = document.createElement("canvas");
  canvas.width = W * scale;
  canvas.height = Math.ceil(height * scale);
  const c = canvas.getContext("2d")!;
  c.scale(scale, scale);
  c.fillStyle = "#ffffff";
  c.fillRect(0, 0, W, height);
  let y = pad;
  for (const op of ops) y += op(c, y);
  return await new Promise<Blob>((resolve, reject) =>
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("No se pudo crear la imagen del comprobante"))), "image/png")
  );
}

function ticketDoc(ctx: AppContext, sale: Sale): PrintableDoc {
  const info = infoFor(ctx, sale);
  return {
    info,
    headline: "",
    meta: [
      ["Folio", saleFolio(sale)],
      ["Fecha", dateLabel(sale.created_at)],
      ...(sale.cashier ? ([["Atendió", sale.cashier]] as Array<[string, string]>) : []),
      ...(info.customer ? ([["Cliente", info.customer]] as Array<[string, string]>) : [])
    ],
    items: sale.items.map((item) => ({
      name: item.name,
      detail: `${itemLabel(item)} × ${fmtMoney(toCents(item.price))}`,
      amount: fmtMoney(lineTotalCents(item.qty, item.price))
    })),
    totalLabel: "TOTAL",
    total: fmtMoney(saleTotalCents(sale)),
    rows: [
      { label: "Pago", value: PAYMENT_LABELS[sale.payment] },
      ...(sale.cash_received
        ? [
            { label: "Pagó con", value: fmtMoney(toCents(sale.cash_received)) },
            { label: "Cambio", value: fmtMoney(toCents(sale.change ?? 0)), size: 17, weight: 800, color: "#2e8a57" }
          ]
        : [])
    ],
    footer: "¡Gracias por su compra!"
  };
}

export async function ticketImage(ctx: AppContext, sale: Sale): Promise<Blob> {
  return documentImage(ticketDoc(ctx, sale));
}

export function returnNoteDoc(ctx: AppContext, ret: SaleReturn): PrintableDoc {
  const info = returnInfoFor(ctx, ret);
  return {
    info,
    headline: "NOTA DE DEVOLUCIÓN",
    meta: [
      ["Folio", returnFolio(ret)],
      ...(ret.folio ? ([["Venta", ret.folio]] as Array<[string, string]>) : []),
      ["Fecha", dateLabel(ret.created_at)],
      ...(ret.cashier ? ([["Atendió", ret.cashier]] as Array<[string, string]>) : []),
      ...(info.customer ? ([["Cliente", info.customer]] as Array<[string, string]>) : [])
    ],
    items: ret.items.map((item) => ({
      name: item.name,
      detail: returnItemLabel(item),
      amount: fmtMoney(lineTotalCents(item.qty, item.price))
    })),
    totalLabel: "TOTAL DEVUELTO",
    total: fmtMoney(returnTotalCents(ret)),
    rows: [
      { label: "Reembolso", value: REFUND_LABELS[ret.payment] },
      ...(ret.reason ? [{ label: "Motivo", value: ret.reason }] : [])
    ],
    footer: "La mercancía regresó al inventario"
  };
}

export async function returnNoteImage(ctx: AppContext, ret: SaleReturn): Promise<Blob> {
  return documentImage(returnNoteDoc(ctx, ret));
}
