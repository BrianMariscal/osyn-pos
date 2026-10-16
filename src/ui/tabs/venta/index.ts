import type { TabModule } from "../tab-module";
import { createCart } from "./cart";
import { createVentaScene } from "./scene";
import { createSearch } from "./search";
import { wireVentaShortcuts } from "./shortcuts";

/**
 * Punto de venta. Izquierda: buscar/escanear y los renglones de la venta.
 * Derecha: el cobro (total, forma de pago, recibido y cambio). En celular todo
 * va en una columna y una barra fija abajo muestra el total y "Cobrar".
 */
export const ventaTab: TabModule = {
  id: "venta",
  render(root, ctx) {
    const scene = createVentaScene(root, ctx);
    const search = createSearch(scene);
    const cart = createCart(scene, search);
    wireVentaShortcuts(scene);

    ctx.store.watch(
      (s) => [s.products, s.product_stocks, s.branches, s.currentBranchId] as const,
      () => {
        search.renderResults();
        cart.renderCart();
      }
    );
  }
};
