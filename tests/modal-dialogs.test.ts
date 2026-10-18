// @vitest-environment jsdom
/**
 * Regresión del bug más grave que tuvo la app: los diálogos de confirmación y
 * captura resolvían SIEMPRE como cancelado (close() disparaba onClose→finish
 * antes que finish(valor)), así que "Registrar pago", "Cerrar corte" y demás
 * botones parecían no hacer nada. Estas pruebas fijan el contrato.
 */
import { describe, expect, it, beforeEach } from "vitest";
import { closeAllModals, confirmDialog, promptDialog } from "../src/ui/components/modal";
import { scanBarcode } from "../src/ui/scanner";

function button(label: string): HTMLButtonElement {
  const found = [...document.querySelectorAll<HTMLButtonElement>("[data-modal-action]")].find(
    (candidate) => candidate.dataset.modalAction === label
  );
  if (!found) throw new Error(`No existe el botón "${label}"`);
  return found;
}

describe("diálogos de confirmación y captura", () => {
  beforeEach(() => {
    closeAllModals();
  });

  it("confirmar resuelve true (antes resolvía false por el cierre)", async () => {
    const result = confirmDialog({ title: "Cerrar corte", message: "¿Seguro?", confirmLabel: "Cerrar corte" });
    button("Cerrar corte").click();
    await expect(result).resolves.toBe(true);
    expect(document.querySelector(".modal-backdrop")).toBeNull();
  });

  it("cancelar, ✕ y el fondo resuelven false", async () => {
    const cancelled = confirmDialog({ title: "T", message: "M" });
    button("Cancelar").click();
    await expect(cancelled).resolves.toBe(false);

    const byClose = confirmDialog({ title: "T", message: "M" });
    document.querySelector<HTMLElement>(".modal-close")!.click();
    await expect(byClose).resolves.toBe(false);

    const byBackdrop = confirmDialog({ title: "T", message: "M" });
    document.querySelector<HTMLElement>(".modal-backdrop")!.click();
    await expect(byBackdrop).resolves.toBe(false);
  });

  it("promptDialog devuelve lo capturado con el botón y con Enter", async () => {
    const byButton = promptDialog({ title: "Pago", type: "number", required: true });
    document.querySelector<HTMLInputElement>("#promptInput")!.value = "40";
    button("Aceptar").click();
    await expect(byButton).resolves.toBe("40");

    const byEnter = promptDialog({ title: "Pago", type: "number", required: true });
    const input = document.querySelector<HTMLInputElement>("#promptInput")!;
    input.value = "25.5";
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    await expect(byEnter).resolves.toBe("25.5");
  });

  it("obligatorio no acepta vacío; cancelar resuelve null", async () => {
    const result = promptDialog({ title: "Pago", type: "number", required: true });
    button("Aceptar").click();
    await Promise.resolve();
    expect(document.querySelector(".modal-backdrop")).not.toBeNull();
    document.querySelector<HTMLInputElement>("#promptInput")!.value = "10";
    button("Aceptar").click();
    await expect(result).resolves.toBe("10");

    const cancelled = promptDialog({ title: "Pago", type: "number" });
    button("Cancelar").click();
    await expect(cancelled).resolves.toBeNull();
  });

  it("el escáner rechaza si no hay cámara (y no se queda colgado)", async () => {
    await expect(scanBarcode()).rejects.toThrow(/cámara/i);
  });
});
