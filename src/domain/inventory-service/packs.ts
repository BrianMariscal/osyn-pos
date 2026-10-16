import { normalizeQty } from "../../core/qty";

/** Convierte cajas/paquetes a piezas: 3 cajas de 12 + 2 sueltas = 38. */
export function unitsFromPacks(packs: number, packSize: number | undefined, loose = 0): number {
  const size = normalizeQty(packSize ?? 0);
  const boxes = normalizeQty(packs);
  return normalizeQty((size > 0 ? boxes * size : boxes) + normalizeQty(loose));
}
