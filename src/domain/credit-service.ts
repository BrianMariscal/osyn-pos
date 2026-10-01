import { nowISO } from "../core/dates";
import { uid } from "../core/id";
import { toCents, toPesos } from "../core/money";
import type { Repositories } from "../data/repositories";
import type { SimpleResult } from "./sale-service";

export type PayResult = (SimpleResult & { warning?: string }) | { ok: false; error: string };

/** Fiado: cargos manuales y pagos, con historial de movimientos por cliente. */
export class CreditService {
  constructor(private repos: Repositories) {}

  charge(customerId: string, amountPesos: number, note: string): PayResult {
    const customer = this.repos.customers.byId(customerId);
    if (!customer) return { ok: false, error: "No se encontró el cliente" };
    const amount = toPesos(toCents(amountPesos));
    if (amount <= 0) return { ok: false, error: "Monto inválido" };
    const ts = nowISO();
    this.repos.customers.upsert({
      ...customer,
      balance: Math.round((customer.balance + amount) * 100) / 100,
      movements: [{ id: uid(), type: "cargo", amount, note: note || "Cargo de fiado", created_at: ts }, ...customer.movements],
      updated_at: ts
    });
    return { ok: true };
  }

  pay(customerId: string, amountPesos: number): PayResult {
    const customer = this.repos.customers.byId(customerId);
    if (!customer) return { ok: false, error: "No se encontró el cliente" };
    const amount = toPesos(toCents(amountPesos));
    if (amount <= 0) return { ok: false, error: "Monto inválido" };
    const ts = nowISO();
    const newBalance = Math.round((customer.balance - amount) * 100) / 100;
    this.repos.customers.upsert({
      ...customer,
      balance: Math.max(0, newBalance),
      movements: [{ id: uid(), type: "pago", amount, note: "Pago recibido", created_at: ts }, ...customer.movements],
      updated_at: ts
    });
    return newBalance < 0
      ? { ok: true, warning: `El pago excede el saldo. Sobrante: ${toPesos(toCents(-newBalance))}` }
      : { ok: true };
  }
}
