import { html, setHtml } from "../core/html";
import { openModal } from "./components/modal";
import {
  chooseCloudVoice,
  cloudVoiceId,
  fetchTtsVoices,
  isSpanishVoice,
  listSpanishVoices,
  pickPreferredVoice,
  preferredVoiceName,
  setPreferredVoiceName,
  speak,
  setCloudVoiceEnabled,
  setCloudVoiceId,
  type TtsVoice
} from "./voice-recognition";

/**
 * Configuración de la voz del asistente (por dispositivo), accesible desde
 * Ajustes y desde el menú de usuario para cualquier rol (incluido vendedor).
 */
/** Ids únicos por instancia: la pestaña Ajustes y el modal pueden coexistir. */
let voiceSettingsSeq = 0;

export function mountVoiceSettings(host: HTMLElement): void {
  const uid = `vs${++voiceSettingsSeq}`;
  setHtml(
    host,
    html`
       <label class="form-field">Voz del asistente
         <select id="${uid}Source" class="input" disabled>
           <option value="cloud">Voz en la nube · ElevenLabs</option>
        </select>
      </label>
      <div id="${uid}DeviceRow" class="row">
        <select id="${uid}DeviceVoice" class="input"></select>
        <button id="${uid}TestDevice" class="ghost" type="button">Probar</button>
      </div>
      <div id="${uid}CloudRow" style="display: none;">
         <div class="row">
           <select id="${uid}CloudVoice" class="input"></select>
           <button id="${uid}RefreshCloud" class="ghost" type="button">Actualizar</button>
         </div>
        <button id="${uid}TestCloud" class="ghost" type="button" style="width: 100%; margin-top: var(--sp-1);">Probar esta voz</button>
         <p class="hint" id="${uid}CloudHint" style="margin: var(--sp-1) 0 0;">Cargando voces de ElevenLabs…</p>
      </div>
    `
  );

  const source = host.querySelector<HTMLSelectElement>(`#${uid}Source`)!;
  const deviceRow = host.querySelector<HTMLElement>(`#${uid}DeviceRow`)!;
  const cloudRow = host.querySelector<HTMLElement>(`#${uid}CloudRow`)!;
  const deviceSelect = host.querySelector<HTMLSelectElement>(`#${uid}DeviceVoice`)!;
  const cloudSelect = host.querySelector<HTMLSelectElement>(`#${uid}CloudVoice`)!;
  const cloudHint = host.querySelector<HTMLElement>(`#${uid}CloudHint`)!;

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

  let cloudVoices: TtsVoice[] = [];

  const voiceLabel = (voice: TtsVoice): string =>
    `${voice.name}${voice.accent ? ` · ${voice.accent}` : voice.language ? ` · ${voice.language}` : ""}`;

  const voiceHintFor = (voice: TtsVoice): string =>
    isSpanishVoice(voice)
      ? `Voz elegida: ${voice.name} (español).`
      : `Voz elegida: ${voice.name}. Para acento mexicano usa una voz en español (por ejemplo «Ingrid») de la Biblioteca de ElevenLabs.`;

  const autoHintFor = (auto: TtsVoice | null): string =>
    auto
      ? isSpanishVoice(auto)
        ? `Automática: usa ${auto.name} (voz en español).`
        : `Automática: aún no hay voces en español; usa ${auto.name}. Agrega una (por ejemplo «Ingrid», mexicana) desde la Biblioteca de ElevenLabs.`
      : "Automática: no hay voces en la biblioteca de ElevenLabs.";

  const loadCloud = async (): Promise<void> => {
    setHtml(cloudSelect, html`<option value="">Cargando voces…</option>`);
    try {
      cloudVoices = await fetchTtsVoices();
      if (!cloudVoices.length) {
        setHtml(cloudSelect, html`<option value="">Sin voces</option>`);
        cloudHint.textContent = "No hay voces en tu biblioteca de ElevenLabs.";
        return;
      }
      const saved = cloudVoiceId();
      const chosen = chooseCloudVoice(cloudVoices, saved);
      const savedVoice = chosen && saved && chosen.voice_id === saved ? chosen : undefined;
      // Si la voz guardada ya no existe en la biblioteca, se limpia y queda en automática.
      if (saved && !savedVoice) setCloudVoiceId("");
      setHtml(
        cloudSelect,
        html`<option value="" ${savedVoice ? null : "selected"}>Automática (prefiere voz en español)</option>
          ${cloudVoices.map(
            (voice) => html`<option value="${voice.voice_id}" ${voice.voice_id === savedVoice?.voice_id ? "selected" : null}>${voiceLabel(voice)}</option>`
          )}`
      );
      cloudHint.textContent = savedVoice ? voiceHintFor(savedVoice) : autoHintFor(pickPreferredVoice(cloudVoices));
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
  cloudSelect.addEventListener("change", () => {
    const value = cloudSelect.value;
    setCloudVoiceId(value);
    if (!value) {
      cloudHint.textContent = autoHintFor(pickPreferredVoice(cloudVoices));
      return;
    }
    const voice = cloudVoices.find((item) => item.voice_id === value);
    if (voice) cloudHint.textContent = voiceHintFor(voice);
  });
  host.querySelector<HTMLButtonElement>(`#${uid}RefreshCloud`)!.addEventListener("click", () => void loadCloud());
  host.querySelector<HTMLButtonElement>(`#${uid}TestDevice`)!.addEventListener("click", () => {
    setCloudVoiceEnabled(false);
    speak("Hola, soy tu asistente de la tienda. ¿En qué te ayudo?", true);
  });
  host.querySelector<HTMLButtonElement>(`#${uid}TestCloud`)!.addEventListener("click", () => {
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
