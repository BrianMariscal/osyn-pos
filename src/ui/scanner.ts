/**
 * Escáner universal de códigos (cámara): ZXing en todos los navegadores
 * (PC incluido). Se carga bajo demanda para no inflar el bundle inicial.
 */
import { html } from "../core/html";
import { openModal } from "./components/modal";

export function scanBarcode(): Promise<string | null> {
  return new Promise((resolve, reject) => {
    if (!navigator.mediaDevices?.getUserMedia) {
      reject(new Error("Este navegador no soporta cámara"));
      return;
    }

    let settled = false;
    let controls: { stop: () => void } | null = null;

    const finish = (code: string | null, error?: Error): void => {
      if (settled) return;
      settled = true;
      try {
        controls?.stop();
      } catch {
        /* la cámara ya se detuvo */
      }
      if (error) reject(error);
      else resolve(code);
    };

    openModal({
      title: "Escanear código o QR",
      content: html`
        <div class="scanner-box">
          <video id="scannerVideo" playsinline muted></video>
        </div>
        <p class="hint">Apunta al código de barras o al código QR del producto.</p>
      `,
      actions: [
        {
          label: "Cancelar",
          kind: "ghost",
          onClick: (close) => {
            finish(null);
            close();
          }
        }
      ],
      // Cerrar con ✕, el fondo o Escape también apaga la cámara.
      onClose: () => finish(null),
      onOpen: async (root, close) => {
        const video = root.querySelector<HTMLVideoElement>("#scannerVideo")!;
        try {
          const { BrowserMultiFormatReader } = await import("@zxing/browser");
          const reader = new BrowserMultiFormatReader();
          controls = await reader.decodeFromVideoDevice(undefined, video, (result) => {
            if (result) {
              const value = result.getText?.() || String(result);
              // Resolver ANTES de cerrar: close() dispara onClose (finish null).
              finish(value);
              close();
            }
          });
        } catch (error) {
          finish(null, new Error(error instanceof Error && error.name === "NotAllowedError" ? "Permiso de cámara denegado" : "No se pudo abrir la cámara"));
          close();
        }
      }
    });
  });
}
