import { moneyToWords, systemSpeak } from "./device";
import { readLocal } from "./storage";

/* ---- Preferencia de voz por dispositivo ---- */
const CLOUD_KEY = "abarrotes-pos-voz-eleven";
const CLOUD_ID_KEY = "abarrotes-pos-voz-eleven-id";
let cloudVoicesPromise: Promise<TtsVoice[] | null> | null = null;
let speechSequence = 0;
let activeCloudAudio: { audio: HTMLAudioElement; url: string; finish: (ok: boolean) => void } | null = null;

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

/** Avisa a la interfaz cuando una voz en la nube falla (para explicar por qué). */
let voiceErrorHandler: ((message: string) => void) | null = null;
let lastVoiceError = "";

export function onVoiceError(handler: (message: string) => void): void {
  voiceErrorHandler = handler;
}

/** Mensaje claro según la respuesta de /api/tts (p. ej. plan sin voces de Biblioteca). */
export function cloudVoiceErrorHint(status: number, detail: string): string {
  if (status === 402 || /paid_plan_required|library voices/i.test(detail)) {
    return "Esa voz es de la Biblioteca de ElevenLabs y necesita plan de pago o $5 de créditos (elevenlabs.io); mientras, se usa la voz del dispositivo.";
  }
  return "No se pudo usar la voz en línea; se usa la voz del dispositivo.";
}

function reportVoiceError(message: string): void {
  if (message === lastVoiceError) return;
  lastVoiceError = message;
  voiceErrorHandler?.(message);
}

function postTts(token: string, voiceId: string, text: string): Promise<Response> {
  return fetch("/api/tts", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ voice_id: voiceId, text })
  });
}

async function cloudSpeak(text: string, sequence: number): Promise<boolean> {
  const token = sessionToken();
  const saved = cloudVoiceId();
  const voiceId = await getPreferredCloudVoiceId();
  if (!token || !voiceId) return false;
  if (sequence !== speechSequence) return false;
  let res = await postTts(token, voiceId, text);
  let detail = res.ok ? "" : await res.text().catch(() => "");
  // El plan sin acceso a voces de la Biblioteca no se reintenta (fallaría igual).
  const planError = !res.ok && (res.status === 402 || /paid_plan_required|library voices/i.test(detail));
  // Si la voz elegida falla por otra razón (por ejemplo, ya no existe en la
  // cuenta), se reintenta con la automática SIN borrar la elección del usuario.
  if (!res.ok && !planError && saved && voiceId === saved && sequence === speechSequence) {
    const fallback = await autoCloudVoiceId();
    if (fallback && fallback !== voiceId) {
      res = await postTts(token, fallback, text);
      if (!res.ok) detail = await res.text().catch(() => "");
    }
  }
  if (!res.ok) {
    reportVoiceError(cloudVoiceErrorHint(res.status, detail));
    return false;
  }
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

/** Voz automática: español (mexicana primero), Jessica o la primera. */
async function autoCloudVoiceId(): Promise<string | null> {
  if (!cloudVoicesPromise) {
    cloudVoicesPromise = fetchTtsVoices().catch(() => null);
  }
  const voices = await cloudVoicesPromise;
  return voices ? pickPreferredVoice(voices)?.voice_id ?? null : null;
}

/**
 * Voz de la nube: la elegida se respeta SIEMPRE y NUNCA se borra sola. Si no
 * hay ninguna elegida, se usa automáticamente una voz en español (mexicana
 * primero) y, si no hay, Jessica.
 */
async function getPreferredCloudVoiceId(): Promise<string | null> {
  const saved = cloudVoiceId();
  if (saved) return saved;
  return autoCloudVoiceId();
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
