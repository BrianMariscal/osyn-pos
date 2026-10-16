// API pública de voz: se mantiene igual para quien importa
// "ui/voice-recognition" (main, app, chat, venta, ajustes y pruebas).
export { listenOnce, speechSupported } from "./dictation";
export { listSpanishVoices, moneyToWords, preferredVoiceName, setPreferredVoiceName } from "./device";
export {
  cloudVoiceErrorHint,
  cloudVoiceId,
  fetchTtsVoices,
  isCloudVoiceEnabled,
  isSpanishVoice,
  onVoiceError,
  pickPreferredVoice,
  setCloudVoiceEnabled,
  setCloudVoiceId,
  speak,
  type TtsVoice
} from "./cloud";
export { isVoiceEnabled, setVoiceEnabled, vibrate } from "./toggle";
