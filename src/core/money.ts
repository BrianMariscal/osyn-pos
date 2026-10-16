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

/* ---- Números en palabras (para la voz) ---- */

const NUM_UNITS = [
  "cero", "uno", "dos", "tres", "cuatro", "cinco", "seis", "siete", "ocho", "nueve",
  "diez", "once", "doce", "trece", "catorce", "quince", "dieciséis", "diecisiete", "dieciocho", "diecinueve",
  "veinte", "veintiuno", "veintidós", "veintitrés", "veinticuatro", "veinticinco", "veintiséis", "veintisiete", "veintiocho", "veintinueve"
];
const NUM_TENS = ["", "", "", "treinta", "cuarenta", "cincuenta", "sesenta", "setenta", "ochenta", "noventa"];
const NUM_HUNDREDS = ["", "ciento", "doscientos", "trescientos", "cuatrocientos", "quinientos", "seiscientos", "setecientos", "ochocientos", "novecientos"];

function under100(n: number, apocope: boolean): string {
  if (n < 30) {
    if (apocope && n === 1) return "un";
    if (apocope && n === 21) return "veintiún";
    return NUM_UNITS[n] ?? String(n);
  }
  const tens = Math.floor(n / 10);
  const units = n % 10;
  if (!units) return NUM_TENS[tens] ?? String(n);
  return `${NUM_TENS[tens]} y ${apocope && units === 1 ? "un" : NUM_UNITS[units]}`;
}

function under1000(n: number, apocope: boolean): string {
  if (n === 100) return "cien";
  const hundreds = Math.floor(n / 100);
  const rest = n % 100;
  const head = NUM_HUNDREDS[hundreds] ?? "";
  if (!rest) return head || "cero";
  const tail = under100(rest, apocope);
  return head ? `${head} ${tail}` : tail;
}

/**
 * Número entero (0 – 999,999,999) en palabras, en español de México.
 * `beforeNoun` aplica la apócope cuando la última palabra antecede al
 * sustantivo: 21 → "veintiún pesos", 1 → "un peso".
 */
export function numberToWords(value: number, beforeNoun = false): string {
  const n = Math.floor(Math.abs(value));
  if (!Number.isFinite(n) || n > 999_999_999) return String(value);
  if (n < 1000) return under1000(n, beforeNoun);
  if (n < 1_000_000) {
    const thousands = Math.floor(n / 1000);
    const rest = n % 1000;
    const head = thousands === 1 ? "mil" : `${under1000(thousands, true)} mil`;
    return rest > 0 ? `${head} ${under1000(rest, beforeNoun)}` : head;
  }
  const millions = Math.floor(n / 1_000_000);
  const rest = n % 1_000_000;
  const head = millions === 1 ? "un millón" : `${under1000(millions, true)} millones`;
  return rest > 0 ? `${head} ${numberToWords(rest, beforeNoun)}` : head;
}

/** Texto para voz (TTS): "$20.50" → "veinte pesos con cincuenta centavos". */
export function speakPesos(pesos: number): string {
  const cents = toCents(Math.abs(Number.isFinite(pesos) ? pesos : 0));
  const whole = Math.floor(cents / 100);
  const dec = cents % 100;
  const parts: string[] = [];
  if (whole > 0) {
    const de = whole >= 1_000_000 && whole % 1_000_000 === 0 ? " de" : "";
    parts.push(`${numberToWords(whole, true)}${de} ${whole === 1 ? "peso" : "pesos"}`);
  }
  if (dec > 0) parts.push(`${numberToWords(dec, true)} ${dec === 1 ? "centavo" : "centavos"}`);
  return parts.join(" con ") || "cero pesos";
}
