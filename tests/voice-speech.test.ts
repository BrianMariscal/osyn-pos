import { describe, expect, it } from "vitest";
import { numberToWords, speakPesos } from "../src/core/money";
import { cloudVoiceErrorHint, isSpanishVoice, moneyToWords, pickPreferredVoice, type TtsVoice } from "../src/ui/voice-recognition";

describe("números en palabras", () => {
  it("unidades, decenas y centenas", () => {
    expect(numberToWords(0)).toBe("cero");
    expect(numberToWords(15)).toBe("quince");
    expect(numberToWords(21)).toBe("veintiuno");
    expect(numberToWords(21, true)).toBe("veintiún");
    expect(numberToWords(100)).toBe("cien");
    expect(numberToWords(101, true)).toBe("ciento un");
    expect(numberToWords(234)).toBe("doscientos treinta y cuatro");
  });

  it("miles y millones", () => {
    expect(numberToWords(1000)).toBe("mil");
    expect(numberToWords(1001)).toBe("mil uno");
    expect(numberToWords(21000, true)).toBe("veintiún mil");
    expect(numberToWords(1234)).toBe("mil doscientos treinta y cuatro");
    expect(numberToWords(1000000)).toBe("un millón");
    expect(numberToWords(1500000)).toBe("un millón quinientos mil");
    expect(numberToWords(2000000)).toBe("dos millones");
  });
});

describe("pesos para la voz", () => {
  it("importes comunes", () => {
    expect(speakPesos(20)).toBe("veinte pesos");
    expect(speakPesos(1)).toBe("un peso");
    expect(speakPesos(21)).toBe("veintiún pesos");
    expect(speakPesos(0.5)).toBe("cincuenta centavos");
    expect(speakPesos(1234.56)).toBe("mil doscientos treinta y cuatro pesos con cincuenta y seis centavos");
    expect(speakPesos(1000000)).toBe("un millón de pesos");
    expect(speakPesos(0)).toBe("cero pesos");
  });

  it("convierte los $ de los textos del asistente", () => {
    expect(moneyToWords("Venta por $20 y $1,234.56")).toBe(
      "Venta por veinte pesos y mil doscientos treinta y cuatro pesos con cincuenta y seis centavos"
    );
  });
});

describe("elección de la voz de la nube", () => {
  const jessica: TtsVoice = { voice_id: "a", name: "Jessica", language: "en", accent: "american" };
  const renata: TtsVoice = { voice_id: "b", name: "Renata", language: "es", accent: "latin american" };
  const ingrid: TtsVoice = { voice_id: "c", name: "Ingrid", language: "es", accent: "mexican" };

  it("detecta voces en español", () => {
    expect(isSpanishVoice(ingrid)).toBe(true);
    expect(isSpanishVoice(renata)).toBe(true);
    expect(isSpanishVoice(jessica)).toBe(false);
  });

  it("prefiere español con acento mexicano y cae a Jessica si no hay", () => {
    expect(pickPreferredVoice([jessica, renata, ingrid])?.voice_id).toBe("c");
    expect(pickPreferredVoice([jessica, renata])?.voice_id).toBe("b");
    expect(pickPreferredVoice([jessica])?.voice_id).toBe("a");
    expect(pickPreferredVoice([])).toBeNull();
  });
});

describe("aviso cuando una voz en línea falla", () => {
  it("explica que las voces de la Biblioteca necesitan plan de pago o créditos", () => {
    expect(cloudVoiceErrorHint(402, "")).toContain("Biblioteca");
    expect(cloudVoiceErrorHint(402, "")).toContain("créditos");
    expect(cloudVoiceErrorHint(502, '{"detail":{"code":"paid_plan_required"}}')).toContain("Biblioteca");
    expect(cloudVoiceErrorHint(502, "Free users cannot use library voices via the API")).toContain("Biblioteca");
  });

  it("aviso genérico para otros errores", () => {
    expect(cloudVoiceErrorHint(502, "otro error")).toContain("dispositivo");
    expect(cloudVoiceErrorHint(500, "")).toContain("dispositivo");
  });
});
