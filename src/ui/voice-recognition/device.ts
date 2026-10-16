import { speakPesos } from "../../core/money";
import { readLocal } from "./storage";

/* ---- Voz: femenina, española de México, y preferencia por dispositivo ---- */
const VOICE_NAME_KEY = "abarrotes-pos-voz-nombre";
let cachedVoices: SpeechSynthesisVoice[] = [];

function loadVoices(): void {
  cachedVoices = window.speechSynthesis?.getVoices?.() ?? [];
}

if (typeof window !== "undefined" && window.speechSynthesis) {
  loadVoices();
  window.speechSynthesis.addEventListener?.("voiceschanged", loadVoices);
}

const MALE_VOICE = /jorge|alvaro|árnau|arnau|pablo|diego|hector|héctor|juan|carlos|andres|andrés|mateo|gonzalo|gerardo|raul|raúl|male|hombre/i;
const FEMALE_VOICE = /dalia|sabina|paulina|angelica|angélica|m[oó]nica|elvira|laia|helena|salom[eé]|isidora|toya|renata|luciana|francisca|camila|abril|estrella|yolanda|mariana|female|mujer/i;

/** "$1,234.56" → "mil doscientos treinta y cuatro pesos con cincuenta y seis centavos". */
export function moneyToWords(text: string): string {
  return text.replace(/\$\s?([\d,]+)(?:\.(\d{1,2}))?/g, (_match, int: string, dec?: string) => {
    const whole = Number(int.replace(/,/g, "")) || 0;
    const cents = dec ? Number(dec.padEnd(2, "0")) || 0 : 0;
    return speakPesos(whole + cents / 100);
  });
}

/* ---- Voces del dispositivo (selector en Ajustes) ---- */
export function listSpanishVoices(): SpeechSynthesisVoice[] {
  if (!cachedVoices.length) loadVoices();
  return cachedVoices.filter((voice) => voice.lang.toLowerCase().startsWith("es"));
}

export function preferredVoiceName(): string {
  return readLocal(VOICE_NAME_KEY);
}

export function setPreferredVoiceName(name: string): void {
  try {
    if (name) localStorage.setItem(VOICE_NAME_KEY, name);
    else localStorage.removeItem(VOICE_NAME_KEY);
  } catch {
    /* almacenamiento no disponible */
  }
}

function pickVoice(): SpeechSynthesisVoice | null {
  if (!cachedVoices.length) loadVoices();
  const preferred = preferredVoiceName();
  if (preferred) {
    const chosen = cachedVoices.find((voice) => voice.name === preferred);
    if (chosen) return chosen;
  }
  const spanish = cachedVoices.filter((voice) => voice.lang.toLowerCase().startsWith("es"));
  if (!spanish.length) return null;
  const mexico = spanish.filter((voice) => /es[-_]mx|es[-_]419|es[-_]us/i.test(voice.lang));
  const pool = mexico.length ? mexico : spanish;
  const femaleNatural = pool.find((voice) => FEMALE_VOICE.test(voice.name) && /natural|neural|online/i.test(voice.name));
  const female = pool.find((voice) => FEMALE_VOICE.test(voice.name));
  const notMale = pool.find((voice) => !MALE_VOICE.test(voice.name));
  return femaleNatural ?? female ?? notMale ?? pool[0] ?? null;
}

export function systemSpeak(text: string): void {
  if (!window.speechSynthesis) return;
  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = "es-MX";
  const voice = pickVoice();
  if (voice) utterance.voice = voice;
  utterance.pitch = 1.08;
  utterance.rate = 0.96;
  window.speechSynthesis.speak(utterance);
}
