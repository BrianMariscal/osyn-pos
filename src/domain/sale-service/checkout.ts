import { nowISO } from "../../core/dates";
import { uid } from "../../core/id";
import { fmtMoney, lineTotalCents, sumCents, toCents, toPesos } from "../../core/money";
import { fmtQty, roundQty4 } from "../../core/qty";
import type { Customer, Sale, SaleItem } from "../../core/types";
import { detectSaleGroup } from "../sale-groups";
import { moveStock } from "../stock-moves";
import type { SaleDeps } from "./deps";
import { lineQty, unitOf } from "./lines";
import { piecesPerUnit, sellsByPack, stockOf, unitPrice } from "./stock";
import type { CompleteSaleInput, CompleteSaleResult } from "./types";

/** Resuelve precio/costo vigentes, mueve stock y registra la venta (y el fiado). */
export function completeSale(deps: SaleDeps, input: CompleteSaleInput): CompleteSaleResult {
  const branchId = deps.branches.operationalId();
  const cart = deps.store.getState().cart;
  if (!cart.length) return { ok: false, error: "El carrito está vacío" };
  const items: SaleItem[] = [];
  const piecesByProduct = new Map<string, number>();
  for (const line of cart) {
    const product = deps.repos.products.byId(line.productId);
    if (!product || product.deleted) return { ok: false, error: "Un producto del carrito ya no existe" };
    const unit = unitOf(line);
    if (unit === "caja" && !sellsByPack(deps, product.id)) return { ok: false, error: `${product.name} ya no se vende por caja` };
    const qty = lineQty(product, line.qty);
    const perUnit = piecesPerUnit(deps, product.id, unit);
    const pieces = roundQty4((piecesByProduct.get(product.id) ?? 0) + qty * perUnit);
    piecesByProduct.set(product.id, pieces);
    if (qty <= 0 || pieces > stockOf(deps, line.productId) + 1e-9) return { ok: false, error: "Revisa cantidades y existencia" };
    const price = unitPrice(deps, line);
    items.push({
      productId: product.id,
      name: product.name,
      qty,
      price,
      ...(unit === "pza" && price !== product.price ? { regular_price: product.price } : {}),
      ...(unit === "caja" ? { pack_size: perUnit } : {}),
      // Costo del renglón por unidad vendida: una caja cuesta sus piezas.
      cost: toPesos(Math.round(toCents(product.cost) * perUnit)),
      um: product.um,
      group: detectSaleGroup(product)
    });
  }
  const internal = input.payment === "interno";
  let customer: Customer | undefined;
  if (input.payment === "fiado") {
    const newName = input.newCustomer?.name.trim() ?? "";
    if (input.customerId) {
      customer = deps.repos.customers.byId(input.customerId);
      if (!customer || customer.deleted) return { ok: false, error: "No se encontró el cliente de fiado" };
    } else if (!newName) {
      return { ok: false, error: "Elige un cliente o escribe el nombre del cliente nuevo" };
    }
  }
  const totalCents = sumCents(items.map((item) => lineTotalCents(item.qty, item.price)));
  const costCents = sumCents(items.map((item) => lineTotalCents(item.qty, item.cost)));
  const ts = nowISO();
  if (input.payment === "fiado" && !customer) {
    // Cliente nuevo capturado desde la venta: queda en el módulo de fiado.
    customer = {
      id: uid(),
      branch_id: branchId,
      name: (input.newCustomer?.name ?? "").trim(),
      phone: (input.newCustomer?.phone ?? "").trim(),
      notes: (input.newCustomer?.notes ?? "").trim(),
      balance: 0,
      movements: [],
      created_at: ts,
      updated_at: ts
    };
  }
  const cashReceived = input.payment === "efectivo" && input.cashReceived && input.cashReceived > 0 ? input.cashReceived : null;
  if (cashReceived !== null && toCents(cashReceived) < totalCents) {
    return { ok: false, error: `El pago no alcanza: faltan ${fmtMoney(totalCents - toCents(cashReceived))}` };
  }
  const serverStock = Boolean(deps.store.getState().sync.serverStock);
  // Venta interna: se registra a costo y sin ganancia (no es ingreso).
  const total = toPesos(internal ? costCents : totalCents);
  const sale: Sale = {
    id: uid(),
    branch_id: branchId,
    items,
    total,
    cost: toPesos(costCents),
    profit: internal ? 0 : toPesos(totalCents - costCents),
    payment: input.payment,
    customer_id: customer ? customer.id : null,
    ...(serverStock ? { stock_by_server: true } : {}),
    ...(cashReceived !== null ? { cash_received: cashReceived, change: toPesos(toCents(cashReceived) - totalCents) } : {}),
    ...(input.cashier ? { cashier: input.cashier } : {}),
    created_at: ts,
    updated_at: ts
  };
  for (const [productId, pieces] of piecesByProduct) {
    moveStock(deps.repos, serverStock, productId, branchId, -pieces, ts);
  }
  if (customer) {
    const detail = items.map((item) => `${fmtQty(item.qty)} ${item.name}`).join(", ");
    const note = `Venta fiada: ${detail.length > 120 ? `${detail.slice(0, 117)}…` : detail}`;
    deps.repos.customers.upsert({
      ...customer,
      balance: Math.round((customer.balance + total) * 100) / 100,
      movements: [{ id: uid(), type: "cargo", amount: total, note, sale_id: sale.id, created_at: ts }, ...customer.movements],
      updated_at: ts
    });
  }
  deps.repos.sales.upsert(sale);
  deps.store.update((state) => {
    state.cart = [];
  });
  return { ok: true, sale };
}
