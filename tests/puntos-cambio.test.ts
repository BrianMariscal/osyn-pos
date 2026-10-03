import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Store } from "../src/domain/store";
import { createInitialState, type AppState } from "../src/domain/app-state";
import { ChangeTracker } from "../src/data/change-tracker";
import { Repositories } from "../src/data/repositories";
import { BranchService } from "../src/domain/branch-service";
import { SaleService } from "../src/domain/sale-service";
import { ExpenseService, dailyTargetCents, fixedCostsForRange } from "../src/domain/expense-service";
import { categoryOptions, lowStockProducts, productsForSupplier, suggestOffers, topSellers } from "../src/domain/catalog";
import { normalizeState } from "../src/domain/normalize";
import { PULL_OVERLAP_MS, pullSince } from "../src/data/sync-engine";
import { RealtimeSync } from "../src/data/realtime";
import { dayRange, nowISO } from "../src/core/dates";
import type { AuthService } from "../src/domain/auth-service";
import type { Expense, Product, Sale } from "../src/core/types";

const DAY = 86_400_000;
const NOW = Date.parse("2026-10-03T18:00:00.000Z");

function product(partial: Partial<Product> & { id: string }): Product {
  return { name: partial.id, category: "", um: "Pza", cost: 10, price: 20, active: true, updated_at: nowISO(), ...partial };
}

function sale(productId: string, daysAgo: number, qty = 1): Sale {
  const at = new Date(NOW - daysAgo * DAY).toISOString();
  return {
    id: `${productId}-${daysAgo}-${qty}`,
    branch_id: "sucursal-1",
    items: [{ productId, name: productId, qty, price: 20, cost: 10, um: "Pza" }],
    total: 20 * qty,
    cost: 10 * qty,
    profit: 10 * qty,
    payment: "efectivo",
    customer_id: null,
    created_at: at,
    updated_at: at
  };
}

describe("1. compras por proveedor", () => {
  it("con proveedor elegido solo lista sus productos", () => {
    const list = [product({ id: "a", supplier_id: "s1" }), product({ id: "b", supplier_id: "s2" }), product({ id: "c" })];
    expect(productsForSupplier(list, "s1").map((p) => p.id)).toEqual(["a"]);
    expect(productsForSupplier(list, "s3")).toEqual([]);
    expect(productsForSupplier(list, "")).toHaveLength(3);
  });
});

describe("2. categorías", () => {
  it("incluye base, usadas y el giro de los proveedores sin duplicar", () => {
    const options = categoryOptions(
      [{ category: "Refrescos" }, { category: "Juguetes" }, { category: "refrescos" }],
      [{ type: "Mascotas" }, { type: "Cerveza" }, { type: "Ferretería", deleted: true }]
    );
    expect(options).toContain("Mascotas");
    expect(options).toContain("Juguetes");
    expect(options).toContain("Abarrotes");
    expect(options).not.toContain("Ferretería");
    expect(options.filter((o) => o.toLowerCase() === "refrescos")).toHaveLength(1);
  });
});

describe("3. sincronización", () => {
  it("el pull relee un margen hacia atrás por relojes desfasados", () => {
    const last = "2026-10-03T12:00:00.000Z";
    expect(Date.parse(last) - Date.parse(pullSince(last))).toBe(PULL_OVERLAP_MS);
    expect(pullSince("basura")).toBe("basura");
  });

  describe("cliente de tiempo real", () => {
    class FakeSocket {
      static last: FakeSocket | null = null;
      readyState = 0;
      sent: Array<Record<string, unknown>> = [];
      onopen: (() => void) | null = null;
      onmessage: ((event: { data: string }) => void) | null = null;
      onclose: (() => void) | null = null;
      onerror: (() => void) | null = null;
      constructor(readonly url: string) {
        FakeSocket.last = this;
      }
      send(data: string): void {
        this.sent.push(JSON.parse(data) as Record<string, unknown>);
      }
      close(): void {
        this.readyState = 3;
      }
      open(): void {
        this.readyState = 1;
        this.onopen?.();
      }
      receive(message: Record<string, unknown>): void {
        this.onmessage?.({ data: JSON.stringify(message) });
      }
    }

    beforeEach(() => vi.useFakeTimers());
    afterEach(() => vi.useRealTimers());

    it("se suscribe, avisa cambios, envía heartbeat y reconecta", () => {
      const changes: string[] = [];
      const statuses: boolean[] = [];
      const rt = new RealtimeSync({
        supabaseUrl: "https://demo.supabase.co",
        apiKey: "anon",
        token: () => "jwt",
        tables: () => ["sales", "products"],
        onChange: (table) => changes.push(table),
        onStatus: (live) => statuses.push(live),
        WebSocketImpl: FakeSocket as unknown as typeof WebSocket
      });
      rt.start();
      const socket = FakeSocket.last!;
      expect(socket.url).toBe("wss://demo.supabase.co/realtime/v1/websocket?apikey=anon&vsn=1.0.0");
      socket.open();
      const join = socket.sent[0]!;
      expect(join.event).toBe("phx_join");
      const payload = join.payload as { access_token: string; config: { postgres_changes: Array<{ table: string }> } };
      expect(payload.access_token).toBe("jwt");
      expect(payload.config.postgres_changes.map((c) => c.table)).toEqual(["sales", "products"]);

      socket.receive({ topic: "realtime:pos-sync", event: "phx_reply", ref: join.ref, payload: { status: "ok" } });
      expect(rt.isLive).toBe(true);
      expect(changes).toEqual(["*"]); // se pone al día al conectar
      socket.receive({ topic: "realtime:pos-sync", event: "postgres_changes", ref: null, payload: { data: { table: "sales" } } });
      expect(changes).toEqual(["*", "sales"]);

      vi.advanceTimersByTime(25_000);
      expect(socket.sent.some((m) => m.event === "heartbeat")).toBe(true);

      socket.onclose?.();
      expect(rt.isLive).toBe(false);
      vi.advanceTimersByTime(1000);
      expect(FakeSocket.last).not.toBe(socket);
      expect(statuses).toEqual([true, false]);
      rt.stop();
    });

    it("si Realtime no está habilitado queda en respaldo", () => {
      const rt = new RealtimeSync({
        supabaseUrl: "https://demo.supabase.co",
        apiKey: "anon",
        token: () => "jwt",
        tables: () => ["sales"],
        onChange: () => undefined,
        WebSocketImpl: FakeSocket as unknown as typeof WebSocket
      });
      rt.start();
      const socket = FakeSocket.last!;
      socket.open();
      const join = socket.sent[0]!;
      socket.receive({ topic: "realtime:pos-sync", event: "phx_reply", ref: join.ref, payload: { status: "ok" } });
      socket.receive({ topic: "realtime:pos-sync", event: "system", ref: null, payload: { status: "error", message: "Unable to subscribe" } });
      expect(rt.isLive).toBe(false);
      rt.stop();
    });
  });
});

describe("4. gastos semanales y mensuales", () => {
  const weekly: Expense = {
    id: "w",
    branch_id: "s",
    concept: "Sueldo",
    amount: 700,
    category: "Sueldos",
    kind: "fijo",
    period: "semanal",
    created_at: new Date(2026, 9, 1, 9).toISOString(),
    updated_at: nowISO()
  };

  it("prorratea el semanal por día (÷ 7)", () => {
    const day = dayRange("2026-10-02");
    expect(fixedCostsForRange([weekly], day.start, day.end)).toBe(10_000);
  });

  it("meta diaria = mensual ÷ días del mes + semanal ÷ 7", () => {
    expect(dailyTargetCents(310_000, new Date(2026, 9, 2), 70_000)).toBe(10_000 + 10_000);
  });

  it("el servicio separa frecuencias y conserva el periodo al recargar", () => {
    const store = new Store<AppState>(createInitialState());
    const repos = new Repositories(store, new ChangeTracker());
    const branches = new BranchService(store, { isAdmin: () => true, isOwner: () => true, employeeBranchId: () => null } as unknown as AuthService, repos);
    branches.ensureSeeded();
    const expenses = new ExpenseService(repos, branches);
    expenses.add("fijo", "Renta", 3100, "Renta", "mensual");
    expenses.add("fijo", "Sueldo", 700, "Sueldos", "semanal");
    expect(expenses.fixedBreakdown()).toEqual({ monthly: 310_000, weekly: 70_000 });
    expect(expenses.dailyTargetCents(undefined, new Date(2026, 9, 2))).toBe(20_000);
    const restored = normalizeState(JSON.parse(JSON.stringify(store.getState())));
    expect(restored.expenses.find((e) => e.concept === "Sueldo")?.period).toBe("semanal");
  });
});

describe("5. recuadros de venta", () => {
  const old = new Date(NOW - 120 * DAY).toISOString();
  const products = [
    product({ id: "vendido", created_at: old }),
    product({ id: "lento30", created_at: old }),
    product({ id: "lento90", created_at: old, price: 20, cost: 10 }),
    product({ id: "sinmargen", created_at: old, price: 10.2, cost: 10 }),
    product({ id: "nuevo", created_at: new Date(NOW - 5 * DAY).toISOString() }),
    product({ id: "agotado", created_at: old })
  ];
  const sales = [sale("vendido", 2, 5), sale("lento30", 40), sale("lento90", 95)];
  const stock = (id: string): number => (id === "agotado" ? 0 : 10);

  it("ofertas: 30+ días sin venta, descuento escalonado, nunca bajo costo + 5 %", () => {
    const offers = suggestOffers(products, sales, stock, NOW);
    const byId = new Map(offers.map((o) => [o.product.id, o]));
    expect(byId.has("vendido")).toBe(false);
    expect(byId.has("nuevo")).toBe(false);
    expect(byId.has("agotado")).toBe(false);
    expect(byId.has("sinmargen")).toBe(false);
    expect(byId.get("lento30")?.offerPrice).toBe(18);
    expect(byId.get("lento90")?.offerPrice).toBe(16);
    expect(offers[0]?.product.id).toBe("lento90");
  });

  it("más vendidos y por agotarse", () => {
    expect(topSellers(products, sales, NOW)[0]?.product.id).toBe("vendido");
    const low = lowStockProducts(products, stock, () => 2);
    expect(low.map((r) => r.product.id)).toEqual(["agotado"]);
  });

  it("vender en oferta cobra el precio de oferta y guarda el normal", () => {
    const store = new Store<AppState>(createInitialState());
    const repos = new Repositories(store, new ChangeTracker());
    const branches = new BranchService(store, { isAdmin: () => true, isOwner: () => true, employeeBranchId: () => null } as unknown as AuthService, repos);
    branches.ensureSeeded();
    const salesService = new SaleService(store, repos, branches);
    repos.products.upsert(product({ id: "p", price: 20, cost: 10 }));
    repos.stocks.upsert({ id: "p:sucursal-1", product_id: "p", branch_id: "sucursal-1", stock: 5, min_stock: 0, updated_at: nowISO() });
    expect(salesService.addToCart("p", 1, 17).ok).toBe(true);
    expect(salesService.addToCart("p", 1).ok).toBe(true); // conserva la oferta del renglón
    const result = salesService.completeSale({ payment: "efectivo", customerId: null });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.sale.total).toBe(34);
    expect(result.sale.items[0]?.regular_price).toBe(20);
    // Una oferta por debajo del costo se ignora
    salesService.addToCart("p", 1, 5);
    expect(salesService.unitPrice(salesService.cart()[0]!)).toBe(20);
  });
});
