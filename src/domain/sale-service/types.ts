import type { PaymentMethod, Sale } from "../../core/types";

export interface NewCustomerInput {
  name: string;
  phone?: string;
  notes?: string;
}

export interface CompleteSaleInput {
  payment: PaymentMethod;
  customerId: string | null;
  /** Fiado a un cliente que aún no existe: se da de alta al cobrar. */
  newCustomer?: NewCustomerInput | null;
  /** Efectivo: con cuánto pagó el cliente (opcional; sin valor no se calcula cambio). */
  cashReceived?: number | null;
  /** Nombre de quien cobra (aparece en el ticket). */
  cashier?: string;
}

export type CompleteSaleResult = { ok: true; sale: Sale } | { ok: false; error: string };

export type SimpleResult = { ok: true } | { ok: false; error: string };
