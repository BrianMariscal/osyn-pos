/**
 * Fechas TZ-safe: los cortes de día/mes se calculan con la zona horaria LOCAL
 * (antes se usaba toISOString() sobre medianoche local y en UTC-6 las ventas
 * después de medianoche caían al día UTC anterior). Todos los límites son
 * [start, end) — end EXCLUSIVO.
 */
export function nowISO(): string {
  return new Date().toISOString();
}

export function localDayStart(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

export function todayStartISO(): string {
  return localDayStart(new Date()).toISOString();
}

/** "2026-09-04" → { start: ISO medianoche local, end: ISO medianoche siguiente (exclusivo) } */
export function dayRange(value: string): { start: string; end: string } {
  const parts = value.split("-").map(Number);
  const y = parts[0] ?? 1970;
  const m = (parts[1] ?? 1) - 1;
  const d = parts[2] ?? 1;
  const start = new Date(y, m, d);
  const end = new Date(y, m, d + 1);
  return { start: start.toISOString(), end: end.toISOString() };
}

/** "2026-09" → rango del mes en ISO local, end exclusivo. */
export function monthRange(value: string): { start: string; end: string } {
  const parts = value.split("-").map(Number);
  const y = parts[0] ?? 1970;
  const m = (parts[1] ?? 1) - 1;
  const start = new Date(y, m, 1);
  const end = new Date(y, m + 1, 1);
  return { start: start.toISOString(), end: end.toISOString() };
}

/** Fecha local de hoy en formato input date: "2026-09-04". */
export function todayInputValue(): string {
  const d = new Date();
  return toInputDateValue(d);
}

export function toInputDateValue(d: Date): string {
  const pad = (n: number): string => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Mes actual en formato input month: "2026-09". */
export function monthInputValue(): string {
  return todayInputValue().slice(0, 7);
}

export function fmtDateTime(iso: string | undefined | null): string {
  const d = new Date(String(iso ?? ""));
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleString("es-MX");
}

export function fmtDate(iso: string | undefined | null): string {
  const d = new Date(String(iso ?? ""));
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleDateString("es-MX");
}

/** Fecha de referencia segura para ordenar filas (created_at/closed_at/updated_at). */
export function rowTime(row: { created_at?: string; closed_at?: string; updated_at?: string }): number {
  const iso = row.updated_at || row.created_at || row.closed_at || "";
  const t = Date.parse(iso);
  return Number.isNaN(t) ? 0 : t;
}

