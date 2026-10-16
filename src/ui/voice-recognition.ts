import { speakPesos } from "../core/money";

type SpeechRecognitionCtor = new () => SpeechRecognitionLike;

interface SpeechRecognitionLike {
  lang: string;
  interimResults: boolean;
  maxAlternatives: number;
  start(): void;
  stop(): void;
  onresult: ((event: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
  onerror: ((event: { error?: string }) => void) | null;
  onend: (() => void) | null;
}

function recognitionCtor(): SpeechRecognitionCtor | null {
  const w = window as unknown as { SpeechRecognition?: SpeechRecognitionCtor; webkitSpeechRecognition?: SpeechRecognitionCtor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export function speechSupported(): boolean {
  return recognitionCtor() !== null;
}

/** Escucha una frase y resuelve con la transcripción. */
export function listenOnce(lang = "es-MX"): Promise<string> {
  const Ctor = recognitionCtor();
  if (!Ctor) return Promise.reject(new Error("Tu navegador no soporta dictado por voz"));
  return new Promise((resolve, reject) => {
    const recognition = new Ctor();
    recognition.lang = lang;
    recognition.interimResults = false;
    recognition.maxAlternatives = 1;
    recognition.onresult = (event) => {
      const transcript = event.results[0]?.[0]?.transcript || "";
      resolve(transcript);
    };
    recognition.onerror = (event) => {
      reject(new Error(event.error === "not-allowed" ? "Permisos de micrófono denegados" : "No se pudo escuchar"));
    };
    recognition.onend = () => undefined;
    try {
      recognition.start();
    } catch (error) {
      reject(error instanceof Error ? error : new Error("No se pudo iniciar el micrófono"));
    }
  });
}

/* ---- Voz: femenina, española de México, y preferencia por dispositivo ---- */
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

function systemSpeak(text: string): void {
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

/* ---- Preferencia de voz por dispositivo ---- */
const VOICE_NAME_KEY = "abarrotes-pos-voz-nombre";
const CLOUD_KEY = "abarrotes-pos-voz-eleven";
const CLOUD_ID_KEY = "abarrotes-pos-voz-eleven-id";
let cloudVoicesPromise: Promise<TtsVoice[] | null> | null = null;
let speechSequence = 0;
let activeCloudAudio: { audio: HTMLAudioElement; url: string; finish: (ok: boolean) => void } | null = null;

function readLocal(key: string): string {
  try {
    return localStorage.getItem(key) ?? "";
  } catch {
    return "";
  }
}

export function isCloudVoiceEnabled(): boolean {
  // La voz del asistente es siempre ElevenLabs (voz en la nube). El
  // activado/desactivado se controla con VOICE_KEY, no aquí.
  return true;
}

export function setCloudVoiceEnabled(value: boolean): void {
  try {
    if (value) localStorage.setItem(CLOUD_KEY, "1");
    else localStorage.removeItem(CLOUD_KEY);
  } catch {
    /* almacenamiento no disponible */
  }
}

export function cloudVoiceId(): string {
  return readLocal(CLOUD_ID_KEY);
}

export function setCloudVoiceId(id: string): void {
  try {
    if (id) localStorage.setItem(CLOUD_ID_KEY, id);
    else localStorage.removeItem(CLOUD_ID_KEY);
  } catch {
    /* almacenamiento no disponible */
  }
}

function sessionToken(): string | null {
  try {
    const raw = localStorage.getItem("abarrotes-pos-auth-v2");
    if (!raw) return null;
    const session = JSON.parse(raw) as { access_token?: string };
    return typeof session.access_token === "string" && session.access_token ? session.access_token : null;
  } catch {
    return null;
  }
}

export interface TtsVoice {
  voice_id: string;
  name: string;
  language: string;
  accent: string;
}

/** ¿La voz habla español? Se mira la etiqueta de idioma y la de acento. */
export function isSpanishVoice(voice: Pick<TtsVoice, "language" | "accent">): boolean {
  const lang = (voice.language ?? "").toLowerCase();
  const accent = (voice.accent ?? "").toLowerCase();
  return lang.startsWith("es") || /mexic|latin american|latino|spanish|español|peninsular|castellano/.test(accent);
}

/** Prefiere una voz en español (mexicana primero); si no hay, Jessica; si no, la primera. */
export function pickPreferredVoice(voices: TtsVoice[]): TtsVoice | null {
  const spanish = voices.filter((voice) => isSpanishVoice(voice));
  return (
    spanish.find((voice) => /mexic/i.test(voice.accent ?? "")) ??
    spanish[0] ??
    voices.find((voice) => voice.name.trim().toLowerCase().includes("jessica")) ??
    voices[0] ??
    null
  );
}

/** Voz de la nube a mostrar/usar: la elegida manda; sin elección, la automática. */
export function chooseCloudVoice(voices: TtsVoice[], savedId: string): TtsVoice | null {
  const savedVoice = savedId ? voices.find((voice) => voice.voice_id === savedId) : undefined;
  return savedVoice ?? pickPreferredVoice(voices);
}

/** Voces de ElevenLabs disponibles (de la biblioteca de la cuenta). */
export async function fetchTtsVoices(): Promise<TtsVoice[]> {
  const token = sessionToken();
  if (!token) throw new Error("Sin sesión");
  const res = await fetch("/api/tts", { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error || "No se pudo leer las voces");
  }
  const body = (await res.json()) as { voices?: Array<Partial<TtsVoice>> };
  return (body.voices ?? []).map((voice) => ({
    voice_id: voice.voice_id ?? "",
    name: voice.name ?? "Voz",
    language: voice.language ?? "",
    accent: voice.accent ?? ""
  }));
}

async function cloudSpeak(text: string, sequence: number): Promise<boolean> {
  const token = sessionToken();
  const voiceId = await getPreferredCloudVoiceId();
  if (!token || !voiceId) return false;
  if (sequence !== speechSequence) return false;
  const res = await fetch("/api/tts", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ voice_id: voiceId, text })
  });
  if (!res.ok) return false;
  const blob = await res.blob();
  if (sequence !== speechSequence) return false;
  const url = URL.createObjectURL(blob);
  const audio = new Audio(url);
  const done = new Promise<boolean>((resolve) => {
    const finish = (ok: boolean): void => {
      if (activeCloudAudio?.audio !== audio) return;
      activeCloudAudio = null;
      URL.revokeObjectURL(url);
      resolve(ok);
    };
    activeCloudAudio = { audio, url, finish };
    audio.onended = () => finish(true);
    audio.onerror = () => finish(false);
  });
  try {
    await audio.play();
    return await done;
  } catch {
    activeCloudAudio?.finish(false);
    return false;
  }
}

function stopCurrentSpeech(): void {
  window.speechSynthesis?.cancel();
  if (activeCloudAudio) {
    const current = activeCloudAudio;
    current.audio.pause();
    current.audio.removeAttribute("src");
    current.finish(false);
  }
}

/**
 * Voz de la nube: la elegida se respeta SIEMPRE. Si no hay ninguna elegida,
 * se usa automáticamente una voz en español (mexicana primero) y, si no hay,
 * Jessica; sin fijarla, para re-evaluar cuando agregues voces nuevas.
 */
async function getPreferredCloudVoiceId(): Promise<string | null> {
  const saved = cloudVoiceId();
  if (saved) return saved;
  if (!cloudVoicesPromise) {
    cloudVoicesPromise = fetchTtsVoices().catch(() => null);
  }
  const voices = await cloudVoicesPromise;
  return voices ? pickPreferredVoice(voices)?.voice_id ?? null : null;
}

export function speak(message: string, enabled: boolean): void {
  const sequence = ++speechSequence;
  stopCurrentSpeech();
  if (!enabled) return;
  const text = moneyToWords(message);
  if (isCloudVoiceEnabled()) {
    void cloudSpeak(text, sequence)
      .then((ok) => {
        if (sequence !== speechSequence) return;
        if (!ok) systemSpeak(text);
      })
      .catch(() => {
        if (sequence === speechSequence) systemSpeak(text);
      });
    return;
  }
  systemSpeak(text);
}

/** La voz se activa o desactiva POR DISPOSITIVO: decisión de quien usa la app. */
const VOICE_KEY = "abarrotes-pos-voz";

export function isVoiceEnabled(): boolean {
  return readLocal(VOICE_KEY) !== "0";
}

export function setVoiceEnabled(value: boolean): void {
  try {
    localStorage.setItem(VOICE_KEY, value ? "1" : "0");
  } catch {
    /* almacenamiento no disponible */
  }
}

export function vibrate(pattern: number | number[]): void {
  navigator.vibrate?.(pattern);
}
