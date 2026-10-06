import type { AppContext } from "../ui/context";
import { matchOrdersToProducts } from "../domain/voice/product-matcher";
import { uid } from "../core/id";
import { fmtMoneyPesos, speakPesos } from "../core/money";
import { speak, isVoiceEnabled } from "../ui/voice-recognition";
import { confirmDialog } from "../ui/components/modal";

export interface AiSaleItem {
  product_id: string;
  name: string;
  qty: number;
}

export interface AiPurchaseItem {
  product_id: string;
  name: string;
  qty?: number;
  packages?: number;
  units_per_package?: number;
  total_paid: number;
}

export interface AssistantAction {
  action: string;
  items?: AiSaleItem[];
  purchase_items?: AiPurchaseItem[];
  amount?: number;
  category?: string;
  concept?: string;
  tab?: string;
  period?: string;
  customer_id?: string;
  customer_name?: string;
  supplier_id?: string;
  supplier_name?: string;
  note?: string;
  message?: string;
  opening_cash?: number;
  counted_cash?: number;
  withdrawn_cash?: number;
  next_opening_cash?: number;
  notes?: string;
}

function authHeaders(ctx: AppContext): Record<string, string> {
  const token = ctx.auth.session?.access_token;
  if (!token) throw new Error("Inicia sesión para usar el asistente");
  return { "Content-Type": "application/json", Authorization: `Bearer ${token}` };
}

/** Interpreta una frase de venta con IA del servidor (requiere sesión). */
export async function parseSaleWithAi(ctx: AppContext, text: string): Promise<AiSaleItem[]> {
  const products = ctx.repos.products
    .list()
    .filter((product) => product.active !== false)
    .slice(0, 500)
    .map((product) => ({
      id: product.id,
      name: product.name,
      category: product.category,
      um: product.um,
      stock: ctx.sales.stockOf(product.id)
    }));
  const res = await fetch("/api/parse-sale", {
    method: "POST",
    headers: authHeaders(ctx),
    body: JSON.stringify({ text, products })
  });
  if (!res.ok) throw new Error("IA no disponible");
  const data = (await res.json()) as { items?: AiSaleItem[] };
  return Array.isArray(data.items) ? data.items : [];
}

export function assistantContext(ctx: AppContext): Record<string, unknown> {
  const branchId = ctx.branches.operationalId();
  return {
    branch: ctx.branches.name(branchId),
    products: ctx.repos.products
      .list()
      .filter((product) => product.active !== false)
      .slice(0, 500)
      .map((product) => ({ id: product.id, name: product.name, category: product.category || "", unit: product.um, stock: ctx.sales.stockOf(product.id) })),
    customers: ctx.repos.customers
      .list()
      .filter((customer) => customer.branch_id === branchId)
      .slice(0, 300)
      .map((customer) => ({ id: customer.id, name: customer.name, balance: customer.balance })),
    suppliers: ctx.repos.suppliers
      .list()
      .slice(0, 100)
      .map((supplier) => ({ id: supplier.id, name: supplier.name })),
    tabs: ["inicio", "venta", "productos", "inventario", "fiado", "gastos", "proveedores", "corte", "reportes", "ajustes"],
    today: new Date().toISOString().slice(0, 10)
  };
}

/** La IA en línea no está configurada en el servidor: no se vuelve a intentar en esta sesión. */
let aiUnavailable = false;

export function isAiUnavailable(): boolean {
  return aiUnavailable;
}

export async function runAssistant(ctx: AppContext, text: string): Promise<AssistantAction> {
  if (aiUnavailable) throw new Error("Asistente IA no disponible");
  // Sin respuesta en 12 s se corta: el asistente contesta con lo que sabe la app
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), 12_000);
  try {
    const res = await fetch("/api/pos-assistant", {
      method: "POST",
      headers: authHeaders(ctx),
      body: JSON.stringify({ text, context: assistantContext(ctx) }),
      signal: controller.signal
    });
    if (res.status === 501) aiUnavailable = true;
    if (!res.ok) throw new Error("Asistente IA no disponible");
    return (await res.json()) as AssistantAction;
  } finally {
    window.clearTimeout(timer);
  }
}

/**
 * Ejecuta la acción del asistente contra los servicios (nunca confía en IDs sin
 * validar). Devuelve el texto que se muestra en el chat.
 *
 * Las acciones que escriben dinero (gasto y fiado) NO se aplican al reconocer la
 * voz: piden confirmación con un modal antes de tocar state.expenses o el saldo
 * del cliente, igual que add_sale_items espera el botón "Cobrar".
 */
export function executeAssistantAction(ctx: AppContext, action: AssistantAction, originalText: string): string {
  const message = action.message || "Listo";
  const say = (text: string): void => speak(text, isVoiceEnabled());
  switch (action.action) {
    case "add_sale_items": {
      const { matched, notFound } = matchOrdersToProducts(action.items ?? [], ctx.repos.products.list());
      let added = 0;
      const names: string[] = [];
      matched.forEach(({ product, qty }) => {
        const result = ctx.sales.addToCart(product.id, qty);
        if (result.ok) {
          added += 1;
          names.push(`${qty} ${product.um} ${product.name}`);
        }
      });
      if (added) {
        ctx.toast(`Agregado: ${names.join(", ")}`);
        say(`Agregue ${names.join(", ")}. Revisa y presiona cobrar.`);
        return `Agregué ${names.join(", ")}. Revisa el carrito y presiona Cobrar.`;
      }
      if (notFound.length) ctx.toast(`No encontré: ${notFound.join(", ")}`);
      say("No encontré productos para agregar.");
      return notFound.length ? `No encontré: ${notFound.join(", ")}` : `No encontré productos en: ${originalText}`;
    }
    case "register_expense": {
      const amount = Number(action.amount || 0);
      if (amount <= 0) return "No entendí el monto del gasto";
      const category = action.category || "Varios";
      const concept = action.concept || "Gasto registrado por asistente";
      const detail = concept && concept !== "Gasto registrado por asistente" ? `: ${concept}` : "";
      void confirmDialog({
        title: "Confirmar gasto",
        message: `¿Registrar un gasto de ${fmtMoneyPesos(amount)} en "${category}"${detail}?`,
        confirmLabel: "Registrar",
        cancelLabel: "Cancelar"
      }).then((confirmed) => {
        if (!confirmed) {
          ctx.toast("Gasto cancelado");
          say("Ok, no registro el gasto.");
          return;
        }
        const ts = new Date().toISOString();
        ctx.repos.expenses.upsert({
          id: uid(),
          branch_id: ctx.branches.operationalId(),
          concept,
          amount: Math.round(amount * 100) / 100,
          category,
          created_at: ts,
          updated_at: ts
        });
        ctx.toast(`Gasto registrado: ${fmtMoneyPesos(amount)}`);
        say(`Gasto registrado por ${speakPesos(amount)}.`);
      });
      return `Se pidió confirmación para el gasto de ${fmtMoneyPesos(amount)}.`;
    }
    case "register_purchase": {
      const supplier =
        ctx.repos.suppliers.list().find((item) => item.id === action.supplier_id) ??
        ctx.repos.suppliers.list().find((item) => sameName(item.name, action.supplier_name));
      const items = (action.purchase_items ?? []).map((item) => ({
        productId: item.product_id,
        qty: Number(item.packages ?? 0) > 0 && Number(item.units_per_package ?? 0) > 0
          ? Number(item.packages) * Number(item.units_per_package)
          : Number(item.qty ?? 0),
        totalPaid: Number(item.total_paid ?? 0),
        name: item.name
      }));
      const validItems = items.filter((item) => item.qty > 0 && Number.isFinite(item.totalPaid) && item.totalPaid >= 0);
      if (!supplier || !validItems.length) return "No encontré el proveedor o los productos de la compra";
      const detail = validItems
        .map((item) => `${item.qty} unidades de ${item.name}${item.totalPaid > 0 ? ` (${fmtMoneyPesos(item.totalPaid)})` : " (costo pendiente)"}`)
        .join(", ");
      void confirmDialog({
        title: "Confirmar compra",
        message: `¿Registrar a ${supplier.name}: ${detail}?`,
        confirmLabel: "Registrar compra",
        cancelLabel: "Cancelar"
      }).then((confirmed) => {
        if (!confirmed) {
          ctx.toast("Compra cancelada");
          say("Ok, no registro la compra.");
          return;
        }
        const result = ctx.inventory.receiveStockMany(validItems, supplier.name);
        if (!result.ok) {
          ctx.toast(result.error);
          say(result.error);
          return;
        }
        ctx.toast(`Compra registrada: ${result.count} productos`);
        say(`Compra registrada con ${result.count} productos.`);
      });
      return `Se pidió confirmación para registrar la compra a ${supplier.name}.`;
    }
    case "go_to_tab": {
      document.querySelector<HTMLElement>(`.tab[data-tab="${action.tab}"]`)?.click();
      ctx.toast(message);
      say(message);
      return message;
    }
    case "open_report": {
      document.querySelector<HTMLElement>('.tab[data-tab="reportes"]')?.click();
      const period = action.period || "day";
      ctx.hooks.openReport?.(period);
      say("Reporte generado.");
      return "Reporte generado.";
    }
    case "prepare_shift_close": {
      document.querySelector<HTMLElement>('.tab[data-tab="corte"]')?.click();
      ctx.hooks.prepareShiftClose?.(action);
      ctx.toast("Corte preparado. Revisa y presiona Cerrar corte.");
      say("Ya preparé el corte. Revisa los datos y presiona cerrar corte.");
      return "Corte preparado. Revisa y presiona Cerrar corte.";
    }
    case "credit_charge": {
      const branchId = ctx.branches.operationalId();
      const customer =
        ctx.repos.customers.list().find((c) => c.id === action.customer_id && c.branch_id === branchId) ??
        ctx.repos.customers.list().find((c) => c.branch_id === branchId && sameName(c.name, action.customer_name));
      const amount = Number(action.amount || 0);
      if (!customer || amount <= 0) return "No encontré el cliente o el monto del fiado";
      const note = action.note || "Fiado registrado por asistente";
      void confirmDialog({
        title: "Confirmar fiado",
        message: `¿Cargar ${fmtMoneyPesos(amount)} al fiado de ${customer.name}?`,
        confirmLabel: "Confirmar",
        cancelLabel: "Cancelar"
      }).then((confirmed) => {
        if (!confirmed) {
          ctx.toast("Fiado cancelado");
          say("Ok, no cargo el fiado.");
          return;
        }
        const result = ctx.credit.charge(customer.id, amount, note);
        if (!result.ok) {
          ctx.toast(result.error);
          return;
        }
        ctx.toast(`Fiado registrado a ${customer.name}: ${fmtMoneyPesos(amount)}`);
        say(`Fiado registrado a ${customer.name} por ${speakPesos(amount)}.`);
      });
      return `Se pidió confirmación para cargar ${fmtMoneyPesos(amount)} al fiado de ${customer.name}.`;
    }
    case "low_stock": {
      document.querySelector<HTMLElement>('.tab[data-tab="inventario"]')?.click();
      const branchId = ctx.branches.operationalId();
      const count = ctx.repos.stocks.list().filter(
        (row) => row.branch_id === branchId && row.stock <= row.min_stock
      ).length;
      ctx.toast(`Productos bajos: ${count}`);
      say(`Hay ${count} productos bajos.`);
      return `Hay ${count} productos bajos.`;
    }
    default:
      ctx.toast("No entendí esa instrucción");
      say("No entendí esa instrucción.");
      return "No entendí esa instrucción.";
  }
}

function sameName(a: string | undefined, b: string | undefined): boolean {
  return Boolean(a && b && a.toLowerCase().includes(b.toLowerCase()));
}
