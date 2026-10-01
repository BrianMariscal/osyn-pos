import { html, setHtml } from "../core/html";
import { openModal } from "./components/modal";
import {
  listSpanishVoices,
  preferredVoiceName,
  setPreferredVoiceName,
  speak,
  setCloudVoiceEnabled,
  setCloudVoiceId,
  fetchTtsVoices
} from "./voice-recognition";

/**
 * Configuración de la voz del asistente (por dispositivo), accesible desde
 * Ajustes y desde el menú de usuario para cualquier rol (incluido vendedor).
 */
export function mountVoiceSettings(host: HTMLElement): void {
  setHtml(
    host,
    html`
       <label class="form-field">Voz del asistente
         <select id="vsSource" class="input" disabled>
           <option value="cloud">Jessica · ElevenLabs</option>
        </select>
      </label>
      <div id="vsDeviceRow" class="row">
        <select id="vsDeviceVoice" class="input"></select>
        <button id="vsTestDevice" class="ghost" type="button">Probar</button>
      </div>
      <div id="vsCloudRow" style="display: none;">
         <div class="row">
           <select id="vsCloudVoice" class="input" disabled></select>
           <button id="vsRefreshCloud" class="ghost" type="button">Actualizar</button>
         </div>
        <button id="vsTestCloud" class="ghost" type="button" style="width: 100%; margin-top: var(--sp-1);">Probar esta voz</button>
         <p class="hint" id="vsCloudHint" style="margin: var(--sp-1) 0 0;">El asistente usa siempre la voz Jessica de ElevenLabs.</p>
      </div>
    `
  );

  const source = host.querySelector<HTMLSelectElement>("#vsSource")!;
  const deviceRow = host.querySelector<HTMLElement>("#vsDeviceRow")!;
  const cloudRow = host.querySelector<HTMLElement>("#vsCloudRow")!;
  const deviceSelect = host.querySelector<HTMLSelectElement>("#vsDeviceVoice")!;
  const cloudSelect = host.querySelector<HTMLSelectElement>("#vsCloudVoice")!;
  const cloudHint = host.querySelector<HTMLElement>("#vsCloudHint")!;

  const apply = (): void => {
     const cloud = true;
    deviceRow.style.display = cloud ? "none" : "grid";
    cloudRow.style.display = cloud ? "grid" : "none";
    setCloudVoiceEnabled(cloud);
    if (cloud) void loadCloud();
  };

  const loadDevice = (): void => {
    const current = preferredVoiceName();
    const voices = listSpanishVoices();
    setHtml(
      deviceSelect,
      html`<option value="">Automática (recomendada)</option>
        ${voices.map((voice) => html`<option value="${voice.name}" ${voice.name === current ? "selected" : null}>${voice.name} · ${voice.lang}</option>`)}`
    );
  };

  const loadCloud = async (): Promise<void> => {
    setHtml(cloudSelect, html`<option value="">Cargando voces…</option>`);
    try {
      const voices = await fetchTtsVoices();
       const jessica = voices.find((voice) => voice.name.trim().toLowerCase().includes("jessica"));
       if (!jessica) {
         setHtml(cloudSelect, html`<option value="">Sin voces</option>`);
         setCloudVoiceId("");
         cloudHint.textContent = "No encontré una voz llamada Jessica en tu biblioteca de ElevenLabs.";
         return;
       }
       setCloudVoiceId(jessica.voice_id);
       setHtml(
         cloudSelect,
         html`<option value="${jessica.voice_id}" selected>${jessica.name}${jessica.language ? ` · ${jessica.language}` : ""}</option>`
       );
       cloudHint.textContent = "Jessica está configurada como la voz fija del asistente.";
    } catch (error) {
      setHtml(cloudSelect, html`<option value="">No disponible</option>`);
      cloudHint.textContent = error instanceof Error ? error.message : "No se pudieron leer las voces.";
    }
  };

   source.value = "cloud";
  apply();
  if (window.speechSynthesis) {
    loadDevice();
    window.speechSynthesis.addEventListener?.("voiceschanged", loadDevice);
  }
  source.addEventListener("change", apply);
  deviceSelect.addEventListener("change", () => setPreferredVoiceName(deviceSelect.value));
  cloudSelect.addEventListener("change", () => setCloudVoiceId(cloudSelect.value));
  host.querySelector<HTMLButtonElement>("#vsRefreshCloud")!.addEventListener("click", () => void loadCloud());
  host.querySelector<HTMLButtonElement>("#vsTestDevice")!.addEventListener("click", () => {
    setCloudVoiceEnabled(false);
    speak("Hola, soy tu asistente de la tienda. ¿En qué te ayudo?", true);
  });
  host.querySelector<HTMLButtonElement>("#vsTestCloud")!.addEventListener("click", () => {
    setCloudVoiceEnabled(true);
    speak("Hola, soy tu asistente de la tienda. ¿En qué te ayudo?", true);
  });
}

export function openVoiceSettings(): void {
  openModal({
    title: "Voz del asistente",
    content: html`<div id="vsHost" style="display: grid; gap: var(--sp-3);"></div>`,
    onOpen: (root) => {
      const host = root.querySelector<HTMLElement>("#vsHost");
      if (host) mountVoiceSettings(host);
    }
  });
}
