import { html, setHtml } from "../core/html";
import { openModal } from "./components/modal";
import {
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

/** Instancias montadas: al elegir una voz se avisa a las demás para que no queden desfasadas. */
const cloudWatchers = new Set<(voiceId: string) => void>();

function notifyCloudVoice(voiceId: string): void {
  for (const watcher of [...cloudWatchers]) watcher(voiceId);
}

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
      ? `Voz elegida: ${voice.name} (español${voice.accent ? ` · ${voice.accent}` : ""}).`
      : `Voz elegida: ${voice.name}. Para acento mexicano usa una voz en español (por ejemplo «Ingrid») de la Biblioteca de ElevenLabs.`;

  const autoHintFor = (auto: TtsVoice | null): string =>
    auto
      ? isSpanishVoice(auto)
        ? `Automática: prefiere ${auto.name} (voz en español).`
        : `Automática: aún no hay voces en español; usa ${auto.name}. Agrega una (por ejemplo «Ingrid», mexicana) desde la Biblioteca de ElevenLabs.`
      : "Automática: no hay voces en la biblioteca de ElevenLabs.";

  const missingHint = "Voz elegida guardada; ahora no aparece en la lista de ElevenLabs.";

  /** Aplica una voz elegida a ESTA instancia (selector + aviso). */
  const applySavedVoice = (voiceId: string): void => {
    if (!cloudSelect.isConnected) {
      cloudWatchers.delete(applySavedVoice);
      return;
    }
    if (!voiceId) {
      cloudSelect.value = "";
      cloudHint.textContent = autoHintFor(pickPreferredVoice(cloudVoices));
      return;
    }
    if ([...cloudSelect.options].some((option) => option.value === voiceId)) {
      cloudSelect.value = voiceId;
    } else {
      // La lista de esta instancia está vieja (sin esa voz): se recarga.
      void loadCloud();
    }
    const voice = cloudVoices.find((item) => item.voice_id === voiceId);
    cloudHint.textContent = voice ? voiceHintFor(voice) : missingHint;
  };

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
      const savedVoice = saved ? cloudVoices.find((voice) => voice.voice_id === saved) : undefined;
      // La voz elegida NUNCA se borra sola: si no aparece en la lista, se
      // conserva y se muestra como elegida.
      setHtml(
        cloudSelect,
        html`<option value="" ${saved ? null : "selected"}>Automática (prefiere voz en español)</option>
          ${saved && !savedVoice ? html`<option value="${saved}" selected>Voz elegida (no aparece en la lista ahora)</option>` : html``}
          ${cloudVoices.map(
            (voice) => html`<option value="${voice.voice_id}" ${voice.voice_id === saved ? "selected" : null}>${voiceLabel(voice)}</option>`
          )}`
      );
      cloudHint.textContent = savedVoice ? voiceHintFor(savedVoice) : saved ? missingHint : autoHintFor(pickPreferredVoice(cloudVoices));
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
  cloudWatchers.add(applySavedVoice);
  cloudSelect.addEventListener("change", () => {
    setCloudVoiceId(cloudSelect.value);
    notifyCloudVoice(cloudSelect.value);
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
