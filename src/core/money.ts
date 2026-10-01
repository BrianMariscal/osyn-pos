/**
 * Dinero: el estado y la base de datos guardan PESOS (número con decimales).
 * Toda ARITMÉTICA de dinero se hace en centavos enteros para evitar errores
 * de punto flotante (0.1 + 0.2). Conversión solo en los bordes.
 */
export type Cents = number;

export function toCents(pesos: number | string | null | undefined): Cents {
  const n = typeof pesos === "string" ? Number(pesos) : (pesos ?? 0);
  const value = Number.isFinite(n) ? (n as number) : 0;
  return Math.round(value * 100);
}

export function toPesos(cents: Cents): number {
  return Math.round(cents) / 100;
}

/** Total en centavos de una línea: cantidad (float, soporta Kg) × precio unitario en pesos. */
export function lineTotalCents(qty: number, unitPricePesos: number): Cents {
  return Math.round(qty * toCents(unitPricePesos));
}

export function sumCents(values: readonly Cents[]): Cents {
  return values.reduce((acc, value) => acc + value, 0);
}

const mxn = new Intl.NumberFormat("es-MX", { style: "currency", currency: "MXN" });

/** Formatea centavos → "$1,234.56" */
export function fmtMoney(cents: Cents): string {
  return mxn.format(toPesos(cents));
}

/** Formatea pesos (valor ya guardado en estado/DB) → "$1,234.56" */
export function fmtMoneyPesos(pesos: number | string | null | undefined): string {
  const n = typeof pesos === "string" ? Number(pesos) : (pesos ?? 0);
  return mxn.format(Number.isFinite(n) ? (n as number) : 0);
}

/** Texto para voz (TTS): sin "$" porque los sintetizadores lo leen "dólares". */
export function speakPesos(pesos: number): string {
  const value = Number.isFinite(pesos) ? Math.abs(pesos) : 0;
  const whole = Math.floor(value);
  const cents = Math.round((value - whole) * 100);
  const base = `${whole} pesos`;
  return cents > 0 ? `${base} con ${cents} centavos` : base;
}
