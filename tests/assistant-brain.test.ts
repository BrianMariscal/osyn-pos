import { describe, expect, it } from "vitest";
import { answerQuestion, type BrainContext } from "../src/domain/assistant-brain";

const ctx: BrainContext = {
  branchName: "Sucursal 1",
  today: { sales: 3450.5, count: 12, profit: 980.25, credit: 250, expenses: 150 },
  week: { sales: 18750, profit: 4320 },
  month: { sales: 62000, profit: 12100, expenses: 8400 },
  creditTotal: 1240,
  topDebtors: [
    { name: "Juan Pérez", balance: 620 },
    { name: "María López", balance: 380 },
    { name: "Don Rosendo", balance: 240 }
  ],
  lowStock: [
    { name: "Coca 600 ml", stock: 1.5, um: "Pza" },
    { name: "Huevo", stock: 4, um: "Pza" }
  ],
  rankings: {
    day: { top: [{ name: "Coca 600 ml", qty: 12, um: "Pza" }], notSold: ["Pan dulce"] },
    week: { top: [{ name: "Leche 1L", qty: 30, um: "Pza" }], notSold: [] },
    month: { top: [{ name: "Arroz", qty: 80, um: "Kg" }], notSold: ["Pinol"] }
  },
  mermasMonth: { total: 156, count: 3 },
  cashExpected: 2870,
  products: [
    { name: "Coca Cola 600 ml", price: 18.5, um: "Pza", stock: 12 },
    { name: "Leche Entera 1L", price: 27, um: "Pza", stock: 4 }
  ]
};

describe("cerebro del asistente (datos locales)", () => {
  it("resume el negocio", () => {
    const answer = answerQuestion("¿cómo va el negocio?", ctx);
    expect(answer).toContain("$3,450.50");
    expect(answer).toContain("Sucursal 1");
    expect(answer).toContain("12 ventas");
  });

  it("responde ventas de hoy", () => {
    expect(answerQuestion("cuánto vendimos hoy?", ctx)).toContain("$3,450.50");
    expect(answerQuestion("cuánto vendimos hoy?", ctx)).toContain("fiado");
  });

  it("responde ganancia y mes", () => {
    expect(answerQuestion("cuál es la ganancia de hoy?", ctx)).toContain("$980.25");
    const month = answerQuestion("cómo va el mes?", ctx);
    expect(month).toContain("$62,000.00");
    expect(month).toContain("$8,400.00");
  });

  it("lista deudores de fiado", () => {
    const answer = answerQuestion("quién me debe de fiado?", ctx);
    expect(answer).toContain("$1,240.00");
    expect(answer).toContain("Juan Pérez: $620.00");
  });

  it("avisa productos por agotarse", () => {
    const answer = answerQuestion("qué productos van bajos?", ctx);
    expect(answer).toContain("2 productos");
    expect(answer).toContain("Coca 600 ml (1.5 Pza)");
  });

  it("explica qué puede hacer", () => {
    expect(answerQuestion("qué puedes hacer?", ctx)).toContain("fiado");
  });

  it("devuelve null cuando la pregunta no es de datos", () => {
    expect(answerQuestion("buenas tardes", ctx)).toBeNull();
    expect(answerQuestion("", ctx)).toBeNull();
  });

  it("no confunde 'gasto' con 'venta'", () => {
    expect(answerQuestion("cuánto van los gastos hoy?", ctx)).toContain("$150.00");
  });

  it("dice lo más vendido por periodo", () => {
    expect(answerQuestion("qué fue lo más vendido hoy?", ctx)).toContain("Coca 600 ml (12 Pza)");
    expect(answerQuestion("lo más vendido del mes?", ctx)).toContain("Arroz (80 Kg)");
  });

  it("entiende '¿qué se vendió más hoy?' (orden invertido)", () => {
    expect(answerQuestion("¿Qué se vendió más hoy?", ctx)).toContain("Coca 600 ml (12 Pza)");
    expect(answerQuestion("qué se vendió más en la semana?", ctx)).toContain("Leche 1L (30 Pza)");
  });

  it("dice qué no se ha vendido por periodo", () => {
    expect(answerQuestion("qué no se ha vendido hoy?", ctx)).toContain("Pan dulce");
    const week = answerQuestion("qué no se ha vendido en la semana?", ctx);
    expect(week).toContain("todos los productos");
  });

  it("responde el precio del producto desde el catalogo", () => {
    const answer = answerQuestion("¿Cuál es el precio de la coca?", ctx);
    expect(answer).toContain("Coca Cola 600 ml");
    expect(answer).toContain("$18.50");
    expect(answer).toContain("12 Pza");
  });

  it("entiende nombres parciales y productos sin precio confundible", () => {
    expect(answerQuestion("a como la leche?", ctx)).toContain("$27.00");
    expect(answerQuestion("cual es el precio?", ctx)).toContain("Dime de qué producto");
  });
});
