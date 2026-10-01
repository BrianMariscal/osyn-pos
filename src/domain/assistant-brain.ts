import { fmtMoneyPesos } from "../core/money";
import { fmtQty } from "../core/qty";
import { normalizeVoiceText } from "./voice/voice-parser";

export interface RankData {
  top: Array<{ name: string; qty: number; um: string }>;
  notSold: string[];
}

export interface ProductQuestionData {
  name: string;
  price: number;
  um: string;
  stock?: number;
}

export interface BrainContext {
  branchName: string;
  today: { sales: number; count: number; profit: number; credit: number; expenses: number };
  week: { sales: number; profit: number };
  month: { sales: number; profit: number; expenses: number };
  creditTotal: number;
  topDebtors: Array<{ name: string; balance: number }>;
  lowStock: Array<{ name: string; stock: number; um: string; branch?: string }>;
  rankings: { day: RankData; week: RankData; month: RankData };
  mermasMonth: { total: number; count: number };
  cashExpected: number;
  products: ProductQuestionData[];
}

/**
 * Responde preguntas del negocio con datos reales del día, sin IA y sin red.
 * Devuelve null cuando la pregunta no es de datos (el flujo cae al asistente IA).
 */
export function answerQuestion(text: string, ctx: BrainContext): string | null {
  const t = normalizeVoiceText(text);
  if (!t) return null;
  const has = (...words: string[]): boolean => words.some((word) => t.includes(word));

  // El precio siempre sale del catalogo local: es un dato exacto y no debe
  // depender de la respuesta probabilistica del modelo ni de la red.
  if (has("precio", "cuesta", "cuanto vale", "cuanto cuesta", "a como", "valor de")) {
    const priceQuestion = t
      .replace(/\b(cual es el|cual es la|cuanto cuesta|cuanto vale|a como esta|a como|dime el|dime la|precio|cuesta|vale|valor de|de|del|la|el|un|una)\b/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    const product = findProduct(priceQuestion, ctx.products);
    if (!product) {
      return priceQuestion
        ? `No encontré un producto llamado "${priceQuestion}". Revisa el nombre en Productos.`
        : "Dime de qué producto quieres saber el precio.";
    }
    const stock = product.stock === undefined ? "" : ` Hay ${fmtQty(product.stock)} ${product.um} disponibles.`;
    return `${product.name}: ${fmtMoneyPesos(product.price)} por ${product.um}.${stock}`;
  }

  if (has("ayuda", "que puedes", "que sabes", "como funciona", "que haces")) {
    return "Puedo decirte: ventas y ganancia de hoy, la semana o el mes; precios y existencias; qué se vendió más; cuánto deben de fiado; productos por agotarse; registrar gastos y compras de varias líneas; o agregar productos al carrito.";
  }

  // Rankings: lo más vendido y lo que no ha salido, por periodo
  // "se vendió más" / "vendimos más" = orden invertido de la misma pregunta
  if (has("mas vendido", "mas vendida", "vendio mas", "vendieron mas", "vendimos mas", "vendi mas", "top", "no se ha vendido", "no se vendio", "no vendido", "sin ventas", "menos vendido", "no ha salido", "no salio", "no se movio")) {
    const rank = has("mes") ? ctx.rankings.month : has("semana") ? ctx.rankings.week : ctx.rankings.day;
    const periodLabel = has("mes") ? "este mes" : has("semana") ? "esta semana" : "hoy";
    const wantsNotSold = has("no se ha vendido", "no se vendio", "no vendido", "sin ventas", "no ha salido", "no salio", "no se movio", "menos vendido");
    if (wantsNotSold) {
      if (!rank.notSold.length) return `Buen registro: ${periodLabel} todos los productos tuvieron al menos una venta.`;
      return `Sin ventas ${periodLabel}: ${rank.notSold.join(", ")}.`;
    }
    if (!rank.top.length) return `Aún no hay ventas ${periodLabel}.`;
    const top = rank.top
      .slice(0, 3)
      .map((product) => `${product.name} (${fmtQty(product.qty)} ${product.um})`)
      .join(", ");
    return `Lo más vendido ${periodLabel}: ${top}.`;
  }

  if (has("mes", "mensual")) {
    return `Este mes: ${fmtMoneyPesos(ctx.month.sales)} en ventas, ${fmtMoneyPesos(ctx.month.profit)} de ganancia y ${fmtMoneyPesos(ctx.month.expenses)} en gastos.`;
  }

  if (has("semana", "semanal", "ultimos dias")) {
    return `Esta semana: ${fmtMoneyPesos(ctx.week.sales)} en ventas y ${fmtMoneyPesos(ctx.week.profit)} de ganancia.`;
  }

  if (has("negocio", "como voy", "como va", "resumen", "resumime")) {
    return `Hoy en ${ctx.branchName}: ${fmtMoneyPesos(ctx.today.sales)} en ${ctx.today.count} ventas, ganancia ${fmtMoneyPesos(ctx.today.profit)}. Fiado pendiente: ${fmtMoneyPesos(ctx.creditTotal)}. Esta semana: ${fmtMoneyPesos(ctx.week.sales)}.`;
  }

  if (has("fiado", "deben", "deuda", "deudor", "deudores", "prestan", "credito")) {
    if (ctx.creditTotal <= 0) return "No hay nada pendiente de fiado.";
    const top = ctx.topDebtors
      .slice(0, 3)
      .map((debtor) => `${debtor.name}: ${fmtMoneyPesos(debtor.balance)}`)
      .join(", ");
    return `Fiado pendiente: ${fmtMoneyPesos(ctx.creditTotal)}. Quien más debe: ${top}.`;
  }

  if (has("bajo", "bajos", "agotan", "agotarse", "faltan", "escaso", "escasos", "inventario")) {
    if (!ctx.lowStock.length) return "Ningún producto está por agotarse.";
    const list = ctx.lowStock
      .slice(0, 5)
      .map((product) => `${product.name} (${fmtQty(product.stock)} ${product.um})`)
      .join(", ");
    return `${ctx.lowStock.length} productos por agotarse: ${list}.`;
  }

  if (has("merma", "mermas", "descompuesto", "caducad", "danad", "dañad", "roto")) {
    if (ctx.mermasMonth.count === 0) return "Este mes no has registrado mermas.";
    return `Mermas del mes: ${fmtMoneyPesos(ctx.mermasMonth.total)} en ${ctx.mermasMonth.count} registros. Se descuentan del inventario, no del efectivo.`;
  }

  if (has("efectivo", "caja", "corte", "cuadra")) {
    return `El efectivo esperado en caja ahora es ${fmtMoneyPesos(ctx.cashExpected)} (sin contar la base inicial). Revisa el corte para cuadrar.`;
  }

  if (has("gasto", "gastos")) {
    return `Hoy llevan ${fmtMoneyPesos(ctx.today.expenses)} en gastos. Para registrar uno dime: gasto 500 de renta.`;
  }

  if (has("ganancia", "gane", "utilidad", "ganado", "util")) {
    return `Hoy has ganado ${fmtMoneyPesos(ctx.today.profit)}. En la semana: ${fmtMoneyPesos(ctx.week.profit)}.`;
  }

  if (has("venta", "vendido", "vendimos", "ventas", "vendiste", "cuanto va", "cuanto llevamos")) {
    return `Hoy llevas ${fmtMoneyPesos(ctx.today.sales)} en ${ctx.today.count} venta${ctx.today.count === 1 ? "" : "s"} (${fmtMoneyPesos(ctx.today.credit)} de fiado).`;
  }

  return null;
}

function findProduct(query: string, products: ProductQuestionData[]): ProductQuestionData | null {
  if (!query) return null;
  const queryWords = new Set(query.split(" ").filter((word) => word.length > 1));
  let best: { product: ProductQuestionData; score: number } | null = null;
  for (const product of products) {
    const name = normalizeVoiceText(product.name);
    const words = name.split(" ").filter((word) => word.length > 1);
    const exact = query.includes(name) || name.includes(query);
    const matches = words.filter((word) => queryWords.has(word) || query.includes(word)).length;
    if (!exact && matches === 0) continue;
    const score = (exact ? 100 : 0) + matches / Math.max(words.length, 1);
    if (!best || score > best.score) best = { product, score };
  }
  return best?.product ?? null;
}
