/** Cantidades: floats redondeados a 2 decimales (también para venta por Kg). */
export function normalizeQty(value: number | string | null | undefined): number {
  const n = Number(value ?? 0);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.round(n * 100) / 100;
}

export function fmtQty(qty: number): string {
  return qty.toLocaleString("es-MX", { maximumFractionDigits: 2 });
}
