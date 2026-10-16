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
