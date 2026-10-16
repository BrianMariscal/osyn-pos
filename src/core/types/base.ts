export type Unit = "Pza" | "Kg" | "Gr" | "Lts";

export const UNITS: readonly Unit[] = ["Pza", "Kg", "Gr", "Lts"];

/** "interno": consumo de la tienda (limpieza, mantenimiento): baja inventario pero NO es venta. */
export type PaymentMethod = "efectivo" | "transferencia" | "tarjeta" | "fiado" | "interno";
export const PAYMENT_METHODS: readonly PaymentMethod[] = ["efectivo", "transferencia", "tarjeta", "fiado", "interno"];
export const PAYMENT_LABELS: Record<PaymentMethod, string> = {
  efectivo: "Efectivo",
  transferencia: "Transferencia",
  tarjeta: "Tarjeta",
  fiado: "Fiado",
  interno: "Venta interna"
};

/** Grupo de producto que el corte reporta por separado. */
export type SaleGroup = "general" | "cigarros" | "cerveza";
export const SALE_GROUPS: readonly SaleGroup[] = ["general", "cigarros", "cerveza"];
export const SALE_GROUP_LABELS: Record<SaleGroup, string> = {
  general: "General",
  cigarros: "Cigarros",
  cerveza: "Cerveza"
};

export type Role = "dueno" | "admin" | "empleado";
export const ROLE_LABELS: Record<Role, string> = {
  dueno: "Dueño",
  admin: "Administrador",
  empleado: "Vendedor"
};
