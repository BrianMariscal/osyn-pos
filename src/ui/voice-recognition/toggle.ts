import { readLocal } from "./storage";

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
