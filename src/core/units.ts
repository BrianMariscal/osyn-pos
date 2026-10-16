/**
 * Productos a granel: el precio del producto SIEMPRE es por su unidad base
 * (Kg, Gr o Lts) y la venta se captura en la subunidad cómoda de la báscula:
 * gramos/kilos para Kg y Gr, mililitros/litros para Lts. También permite
 * capturar un importe ("$20 de jitomate") y calcular la cantidad.
 */
import { roundQty4 } from "./qty";
import type { Unit } from "./types";

export interface BulkSubunit {
  id: "g" | "kg" | "ml" | "l";
  label: string;
  /** Cuántas unidades base vale 1 subunidad (1 g = 0.001 Kg). */
  factor: number;
}

/** ¿El producto se vende por peso/volumen (báscula)? */
export function isBulkUnit(um: Unit | undefined | null): boolean {
  return um === "Kg" || um === "Gr" || um === "Lts";
}

/** Subunidades de captura del producto, de la más chica a la más grande. */
export function bulkSubunits(um: Unit): BulkSubunit[] {
  if (um === "Lts") {
    return [
      { id: "ml", label: "ml", factor: 0.001 },
      { id: "l", label: "L", factor: 1 }
    ];
  }
  if (um === "Kg") {
    return [
      { id: "g", label: "g", factor: 0.001 },
      { id: "kg", label: "kg", factor: 1 }
    ];
  }
  // Unidad base en gramos
  return [
    { id: "g", label: "g", factor: 1 },
    { id: "kg", label: "kg", factor: 1000 }
  ];
}

/**
 * Subunidad por defecto al abrir un renglón nuevo: gramos para Kg/Gr y litros
 * para Lts (lo que más se teclea al vender a granel).
 */
export function defaultBulkSubunit(um: Unit): BulkSubunit {
  const subunits = bulkSubunits(um);
  return um === "Lts" ? subunits[subunits.length - 1]! : subunits[0]!;
}

/** Captura en subunidad → unidad base del producto (350 g → 0.35 Kg). */
export function toBaseQty(value: number, subunit: BulkSubunit): number {
  return roundQty4(value * subunit.factor);
}

/** Unidad base → valor para el campo en la subunidad (0.35 Kg → 350 g). */
export function fromBaseQty(qty: number, subunit: BulkSubunit): number {
  return roundQty4(qty / subunit.factor);
}

/**
 * Cantidad (unidad base, 4 decimales) que se vende con un importe dado, al
 * precio por unidad base. Con 4 decimales el total cuadra al centavo aunque el
 * precio no divida exacto ($20 a $30/kg → 0.6667 Kg → $20.00).
 */
export function qtyFromAmount(amountPesos: number, unitPricePesos: number): number {
  if (!(unitPricePesos > 0) || !(amountPesos > 0)) return 0;
  return roundQty4(amountPesos / unitPricePesos);
}

/** Cantidades rápidas de venta (en unidad base) con su etiqueta. */
export function bulkQuickPicks(um: Unit): Array<{ qty: number; label: string }> {
  if (um === "Gr") {
    return [
      { qty: 250, label: "250 g" },
      { qty: 500, label: "500 g" },
      { qty: 1000, label: "1 kg" },
      { qty: 2000, label: "2 kg" }
    ];
  }
  if (um === "Lts") {
    return [
      { qty: 0.25, label: "250 ml" },
      { qty: 0.5, label: "500 ml" },
      { qty: 1, label: "1 L" },
      { qty: 2, label: "2 L" }
    ];
  }
  return [
    { qty: 0.25, label: "250 g" },
    { qty: 0.5, label: "500 g" },
    { qty: 1, label: "1 kg" },
    { qty: 2, label: "2 kg" }
  ];
}

/** Importes rápidos del modo "$20 de…". */
export const AMOUNT_QUICK_PICKS: readonly number[] = [10, 20, 50, 100];
