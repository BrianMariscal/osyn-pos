import { createCheckout } from "./checkout";
import { createCartLines } from "./lines";
import { createPaymentPanel } from "./payment";
import { type VentaScene } from "../scene";
import type { VentaSearch } from "../search";

/** Carrito y cobro: renglones, formas de pago, efectivo, fiado y venta completa. */
export function createCart(scene: VentaScene, search: VentaSearch): { renderCart(): void } {
  const { ctx } = scene;
  const { renderPaymentState, renderCustomers } = createPaymentPanel(scene);
  const { renderCart } = createCartLines(scene, renderPaymentState);
  createCheckout(scene, search, renderCart);

  ctx.store.watch((s) => s.cart, renderCart);
  ctx.store.watch((s) => [s.customers, s.branches, s.currentBranchId] as const, renderCustomers);

  return { renderCart };
}
