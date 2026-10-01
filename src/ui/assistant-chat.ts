import { html, safe, setHtml } from "../core/html";
import { dayRange, monthInputValue, toInputDateValue, todayInputValue } from "../core/dates";
import { sumCents, toCents, toPesos } from "../core/money";
import { VIEW_ALL } from "../domain/app-state";
import { answerQuestion, type BrainContext, type RankData } from "../domain/assistant-brain";
import type { PeriodReport } from "../core/types";
import { runAssistant, executeAssistantAction } from "../ai/assistant-client";
import { listenOnce, speak, speechSupported, isVoiceEnabled } from "./voice-recognition";
import { openModal } from "./components/modal";
import type { AppContext } from "./context";

interface ChatMessage {
  who: "user" | "bot";
  text: string;
}

const MIC_ICON = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="9" y="3" width="6" height="11" rx="3"></rect><path d="M5 11a7 7 0 0 0 14 0"></path><path d="M12 18v3"></path></svg>';

/** Datos reales del negocio para el cerebro local. */
function buildBrain(ctx: AppContext): BrainContext {
  // El asistente analiza la sucursal operativa (donde se vende), no el alcance
  // de vista del dashboard.
  const scope = ctx.branches.operationalId();
  const inScope = (branchId: string | null | undefined): boolean =>
    scope === VIEW_ALL || !branchId || branchId === scope;
  const today = dayRange(todayInputValue());
  const todayReport = ctx.reports.periodReport(scope, today.start, today.end);

  const sixDaysAgo = new Date();
  sixDaysAgo.setDate(sixDaysAgo.getDate() - 6);
  const weekStart = dayRange(toInputDateValue(sixDaysAgo)).start;
  const weekReport = ctx.reports.periodReport(scope, weekStart, today.end);
  const monthReport = ctx.reports.monthReport(scope, monthInputValue());

  const rankFor = (report: PeriodReport): RankData => ({
    top: report.top_products.slice(0, 3).map((stat) => ({ name: stat.name, qty: stat.qty, um: stat.um })),
    notSold: report.slow_products.filter((stat) => stat.qty === 0).map((stat) => stat.name).slice(0, 6)
  });

  const debtors = ctx.repos.customers
    .list()
    .filter((customer) => inScope(customer.branch_id) && customer.balance > 0)
    .sort((a, b) => b.balance - a.balance);
  const productsById = new Map(ctx.repos.products.list().map((product) => [product.id, product]));
  const products = ctx.repos.products
    .list()
    .filter((product) => product.active !== false)
    .map((product) => ({
      name: product.name,
      price: product.price,
      um: product.um,
      stock: ctx.sales.stockOf(product.id)
    }));
  const lowStock = ctx.repos.stocks
    .list()
    .filter((row) => inScope(row.branch_id) && row.stock <= row.min_stock)
    .map((row) => ({
      name: productsById.get(row.product_id)?.name ?? row.product_id,
      stock: row.stock,
      um: productsById.get(row.product_id)?.um ?? "Pza",
      branch: scope === VIEW_ALL ? ctx.branches.name(row.branch_id) : undefined
    }));

  const multi = ctx.branches.isMultiBranch();
  const storeName = ctx.store.getState().settings.storeName || "tu tienda";
  return {
    branchName:
      scope === VIEW_ALL ? "todas tus sucursales" : multi ? ctx.branches.name(scope) : storeName,
    today: { sales: todayReport.sales_total, count: todayReport.sales_count, profit: todayReport.profit_after_expenses, credit: todayReport.credit_total, expenses: todayReport.expenses_total },
    week: { sales: weekReport.sales_total, profit: weekReport.profit_after_expenses },
    month: { sales: monthReport.sales_total, profit: monthReport.profit_after_expenses, expenses: monthReport.expenses_total },
    creditTotal: toPesos(sumCents(debtors.map((customer) => toCents(customer.balance)))),
    topDebtors: debtors.slice(0, 3).map((customer) => ({ name: customer.name, balance: customer.balance })),
    lowStock,
    rankings: { day: rankFor(todayReport), week: rankFor(weekReport), month: rankFor(monthReport) },
    products,
    mermasMonth: (() => {
      const month = monthInputValue();
      const inMonth = ctx.repos.mermas
        .list()
        .filter((merma) => inScope(merma.branch_id) && merma.created_at.slice(0, 7) === month);
      return { total: toPesos(sumCents(inMonth.map((merma) => toCents(merma.cost_impact)))), count: inMonth.length };
    })(),
    cashExpected: ctx.shifts.summarize(ctx.branches.operationalId()).efectivoEsperado
  };
}

const SUGGESTIONS = ["¿Cómo va el negocio?", "¿Cuál es el precio de la Coca?", "Ventas de hoy", "¿Qué se vendió más hoy?", "¿Qué no se ha vendido esta semana?", "¿Quién debe de fiado?", "¿Cómo va la caja?", "Mermas del mes", "Productos por agotarse"];

/** Asistente conversacional: chat con cerebro local (datos) + IA para acciones. */
export function openAssistantChat(ctx: AppContext): void {
  const messages: ChatMessage[] = [
    {
      who: "bot",
      text: "Hola. Pregúntame por tus ventas, precios, ganancia, fiado o inventario. También registro gastos, compras con varias líneas y agrego productos al carrito."
    }
  ];

  openModal({
    title: "Asistente de la tienda",
    content: html`
      <div class="chat">
        <div class="chat-log" id="chatLog"></div>
        <div class="chat-chips" id="chatChips"></div>
        <form class="chat-input" id="chatForm">
          <input id="chatText" class="input" placeholder="Escribe tu pregunta…" autocomplete="off">
          <button class="icon-btn" type="button" id="chatMic" aria-label="Hablar">${safe(MIC_ICON)}</button>
          <button class="primary" type="submit">Enviar</button>
        </form>
      </div>
    `,
    onOpen: async (root) => {
      const log = root.querySelector<HTMLElement>("#chatLog")!;
      const input = root.querySelector<HTMLInputElement>("#chatText")!;
      const chips = root.querySelector<HTMLElement>("#chatChips")!;
      const form = root.querySelector<HTMLFormElement>("#chatForm")!;
      const mic = root.querySelector<HTMLButtonElement>("#chatMic")!;
      // iPhone: sin dictado (Web Speech API) — el chat funciona escribiendo
      if (!speechSupported()) mic.classList.add("hidden");
      const voiceOn = isVoiceEnabled;

      const renderLog = (): void => {
        setHtml(
          log,
          html`${messages.map(
            (message) => html`<div class="chat-msg ${message.who === "user" ? "chat-user" : "chat-bot"}">${message.text}</div>`
          )}`
        );
        log.scrollTop = log.scrollHeight;
      };

      const reply = (text: string): void => {
        messages.push({ who: "bot", text });
        renderLog();
        speak(text, voiceOn());
      };

      const handle = async (raw: string): Promise<void> => {
        const text = raw.trim();
        if (!text) return;
        messages.push({ who: "user", text });
        renderLog();
        input.value = "";

        const local = answerQuestion(text, buildBrain(ctx));
        if (local) {
          reply(local);
          return;
        }
        try {
          const action = await runAssistant(ctx, text);
          const result = executeAssistantAction(ctx, action, text);
          reply(result || action.message || "Listo.");
        } catch {
          reply("No pude conectar con la IA en línea. Puedo responderte de memoria sobre ventas, ganancia, fiado, caja, mermas o inventario.");
        }
      };

      form.addEventListener("submit", (event) => {
        event.preventDefault();
        void handle(input.value);
      });

      setHtml(
        chips,
        html`${SUGGESTIONS.map(
          (suggestion) => html`<button class="chip chat-chip" type="button">${suggestion}</button>`
        )}`
      );
      chips.addEventListener("click", (event) => {
        const chip = (event.target as HTMLElement).closest<HTMLElement>(".chat-chip");
        if (chip) void handle(chip.textContent ?? "");
      });

      mic.addEventListener("click", async () => {
        if (!speechSupported()) {
          ctx.toast("Tu navegador no soporta dictado por voz");
          return;
        }
        mic.disabled = true;
        try {
          const transcript = await listenOnce();
          input.value = transcript;
          await handle(transcript);
        } catch (error) {
          ctx.toast(error instanceof Error ? error.message : "No se pudo escuchar");
        } finally {
          mic.disabled = false;
        }
      });

      renderLog();
      input.focus();
    }
  });
}
