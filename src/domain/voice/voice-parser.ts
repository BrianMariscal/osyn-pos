import { normalizeQty } from "../../core/qty";

export interface VoiceOrder {
  qty: number;
  name: string;
}

const NUMBER_WORDS: Record<string, number> = {
  un: 1, una: 1, uno: 1,
  dos: 2, tres: 3, cuatro: 4, cinco: 5, seis: 6, siete: 7, ocho: 8, nueve: 9,
  diez: 10, once: 11, doce: 12, trece: 13, catorce: 14, quince: 15,
  veinte: 20, treinta: 30, cuarenta: 40, cincuenta: 50,
  medio: 0.5, media: 0.5
};

const UNIT_WORDS = ["pieza", "piezas", "pza", "pzas", "kilo", "kilos", "kg", "gramo", "gramos", "gr", "litro", "litros", "lts"];
const FILLER_WORDS = ["de", "del", "la", "el", "los", "las", "un", "una", "unos", "unas"];
const COMMAND_WORDS = /\b(agrega|agregar|dame|pon|ponme|vende|vendeme|cobrame|cobrar|quiero|anota|anotame|registra)\b/g;

export function normalizeVoiceText(value: string | undefined | null): string {
  return String(value ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9.\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function voiceNumber(word: string): number | null {
  if (/^\d+(\.\d+)?$/.test(word)) return normalizeQty(word);
  return NUMBER_WORDS[word] ?? null;
}

export function isVoiceUnit(word: string): boolean {
  return UNIT_WORDS.includes(word);
}

/** Interpreta una frase dictada en español: "dos coca colas, una leche y 3 pan". */
export function parseVoiceSale(text: string): VoiceOrder[] {
  const cleaned = normalizeVoiceText(text).replace(COMMAND_WORDS, " ");
  const directParts = cleaned
    .split(/,|\by\b|\bmas\b|\bcon\b/)
    .map((part) => part.trim())
    .filter(Boolean);
  const expanded = directParts.flatMap(splitVoicePartByQuantities);
  return expanded.map(parseVoiceItem).filter((order): order is VoiceOrder => order !== null);
}

export function splitVoicePartByQuantities(part: string): string[] {
  const words = normalizeVoiceText(part).split(" ").filter(Boolean);
  if (words.length < 4) return [part];
  const parts: string[] = [];
  let current: string[] = [];
  words.forEach((word, index) => {
    const previous = words[index - 1] ?? "";
    const startsNewItem = current.length > 1 && voiceNumber(word) !== null && !isVoiceUnit(previous);
    if (startsNewItem) {
      parts.push(current.join(" "));
      current = [word];
    } else {
      current.push(word);
    }
  });
  if (current.length) parts.push(current.join(" "));
  return parts.length > 1 ? parts : [part];
}

export function parseVoiceItem(part: string): VoiceOrder | null {
  let words = normalizeVoiceText(part).split(" ").filter(Boolean);
  if (!words.length) return null;
  let qty = 1;
  const qtyIndex = words.findIndex((word) => voiceNumber(word) !== null);
  if (qtyIndex >= 0) {
    const parsed = voiceNumber(words[qtyIndex] as string);
    if (parsed !== null) qty = parsed;
    words.splice(qtyIndex, 1);
    const nextWord = words[qtyIndex] ?? "";
    const previousWord = words[qtyIndex - 1] ?? "";
    if (isVoiceUnit(nextWord)) words.splice(qtyIndex, 1);
    else if (isVoiceUnit(previousWord)) words.splice(qtyIndex - 1, 1);
  }
  words = words.filter((word) => !isVoiceUnit(word));
  const name = words.filter((word) => !FILLER_WORDS.includes(word)).join(" ").trim();
  return name ? { qty, name } : null;
}
