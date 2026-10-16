import { z } from "zod";
import { SALE_GROUPS, UNITS } from "../../core/types";
import type { Unit } from "../../core/types";

export const iso = z.string().catch("");
export const num = z.coerce.number().catch(0);
export const bool = z.coerce.boolean().catch(false);

/** Opcional que tolera basura: valor inválido → undefined (nunca rompe el arranque). */
export const optionalString = z.string().optional().catch(undefined);
export const optionalPositive = z.coerce.number().positive().optional().catch(undefined);
export const optionalNonNegative = z.coerce.number().min(0).optional().catch(undefined);
export const saleGroupSchema = z.enum(SALE_GROUPS as unknown as [string, ...string[]]).optional().catch(undefined);

export const unitSchema = z
  .string()
  .catch("Pza")
  .transform((value): Unit => ((UNITS as readonly string[]).includes(value) ? (value as Unit) : "Pza"));
