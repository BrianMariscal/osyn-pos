/**
 * Cantidades: floats redondeados a 2 decimales (también para venta por Kg).
 * A granel se usa `normalizeBulkQty` (décima de gramo) para que la captura por
 * gramos y la venta por importe cuadren al centavo.
 */
export function normalizeQty(value: number | string | null | undefined): number {
  const n = Number(value ?? 0);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.round(n * 100) / 100;
}

/**
 * Redondeo a 4 decimales (décima de gramo/ml) sin recortar negativos: para
 * deltas de existencia y cantidades a granel.
 */
export function roundQty4(value: number): number {
  return Number.isFinite(value) ? Math.round(value * 10000) / 10000 : 0;
}

/** Redondeo a 3 decimales (gramo/ml), por ejemplo para mostrar o comparar. */
export function roundQty3(value: number): number {
  return Number.isFinite(value) ? Math.round(value * 1000) / 1000 : 0;
}

/** Igual que normalizeQty pero a granel: hasta 4 decimales (0.1 g/ml). */
export function normalizeBulkQty(value: number | string | null | undefined): number {
  const n = Number(value ?? 0);
  if (!Number.isFinite(n) || n < 0) return 0;
  return roundQty4(n);
}

export function fmtQty(qty: number): string {
  return qty.toLocaleString("es-MX", { maximumFractionDigits: 3 });
}
