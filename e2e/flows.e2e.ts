import { expect, test } from "@playwright/test";
import { prepare } from "./fixture";

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 960 });
  await prepare(page);
  await page.locator('[data-tab="venta"]').click();
});

test("una venta en efectivo descuenta existencia", async ({ page }) => {
  await page.locator("#productSearch").fill("coca 600");
  await expect(page.locator("[data-result]").first()).toContainText("48 Pza");
  await page.locator("[data-result]").first().click();
  await expect(page.locator(".pos-line")).toHaveCount(1);

  await page.locator("#cashReceived").fill("100");
  await page.locator("#completeSale").click();
  await expect(page.locator("#toastRoot")).toContainText("Venta registrada");

  // Cierra el ticket y verifica que el stock bajó.
  await page.locator(".modal-close").last().click();
  await page.locator("#productSearch").fill("coca 600");
  await expect(page.locator("[data-result]").first()).toContainText("47 Pza");
});

test("Enter en Recibido no cobra la venta", async ({ page }) => {
  await page.locator("#productSearch").fill("coca 600");
  await page.locator("[data-result]").first().click();
  await page.locator("#cashReceived").fill("100");

  await page.locator("#cashReceived").press("Enter");

  // Solo mueve el foco al botón; no registra nada.
  await expect(page.locator("#completeSale")).toBeFocused();
  await expect(page.locator("#toastRoot")).not.toContainText("Venta registrada");
  await expect(page.locator(".pos-line")).toHaveCount(1);
  await expect(page.locator(".modal")).toHaveCount(0);
});

test("una ráfaga de escáner en Recibido agrega el producto, no cobra", async ({ page }) => {
  await page.locator("#cashReceived").focus();
  await page.evaluate(() => {
    const input = document.querySelector<HTMLInputElement>("#cashReceived")!;
    for (const key of "7501055300017") {
      input.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true }));
    }
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
  });

  await expect(page.locator(".pos-line")).toHaveCount(1);
  await expect(page.locator(".pos-line").first()).toContainText("Coca-Cola 600 ml");
  await expect(page.locator("#cashReceived")).toHaveValue("");
  await expect(page.locator("#toastRoot")).not.toContainText("Venta registrada");
});

test("el catálogo oculta agotados por defecto y los revela a petición", async ({ page }) => {
  await page.locator("#productSearch").fill("plátano");

  await expect(page.locator("[data-result]")).toHaveCount(0);
  await expect(page.locator(".search-empty")).toContainText("Sin existencia");

  await page.locator("[data-toggle-stock]").click();
  await expect(page.locator("[data-result]")).toHaveCount(1);
  await expect(page.locator("[data-result]").first()).toContainText("Agotado");
});

test("una venta fiada suma al saldo del cliente", async ({ page }) => {
  await page.locator("#productSearch").fill("leche");
  await page.locator("[data-result]").first().click();
  await page.locator('[data-pay="fiado"]').click();
  await page.locator("#creditCustomer").selectOption("cli-1");
  await page.locator("#completeSale").click();
  await expect(page.locator(".modal")).toContainText("Venta fiada registrada");

  await page.locator(".modal-close").last().click();
  await page.locator('[data-tab="fiado"]').click();
  await expect(page.locator("#customersList")).toContainText("María López");
  await expect(page.locator("#customersList")).toContainText("$212.50");
});

test("cerrar el corte con el efectivo contado deja diferencia cero", async ({ page }) => {
  await page.locator('[data-tab="corte"]').click();
  const expectedText = await page
    .locator("#cashSummary .row-strong", { hasText: "Efectivo esperado con base" })
    .locator("strong")
    .textContent();
  const expected = Number((expectedText ?? "0").replace(/[^\d.-]/g, ""));

  await page.locator("#openingCash").fill("0");
  await page.locator("#cashCounted").fill(String(expected));
  await expect(page.locator("#cashSummary")).toContainText("Diferencia (contado + retirado − esperado)");

  const before = await page.locator("#shiftsList .list-item").count();
  await page.locator("#closeShift").click();
  await page.locator('.modal [data-modal-action="Cerrar corte"]').click();

  await expect(page.locator("#toastRoot")).toContainText("Corte cerrado");
  await expect(page.locator("#shiftsList .list-item")).toHaveCount(before + 1);
  await expect(page.locator("#shiftsList .list-item").first()).toContainText("Dif $0.00");
});

test("una venta hecha sin red se sube al reconectar", async ({ page }) => {
  await page.context().setOffline(true);
  await page.locator("#productSearch").fill("coca 600");
  await page.locator("[data-result]").first().click();
  await page.locator("#completeSale").click();
  await expect(page.locator("#toastRoot")).toContainText("Venta registrada");
  await page.locator(".modal-close").last().click();
  await expect(page.locator("#syncDot")).toHaveAttribute("data-state", "offline");

  await page.context().setOffline(false);
  // En Ajustes se fuerza la sincronización y se ve el estado real.
  await page.locator("[data-more]").click();
  await page.locator('.modal [data-tab="ajustes"]').click();
  await page.locator("#syncNow").click();
  await expect(page.locator("#toastRoot")).toContainText("Respaldo sincronizado");
  await expect(page.locator("#syncInfo")).toContainText("Pendientes 0");
});

test("el conteo físico ajusta la existencia y queda en el historial", async ({ page }) => {
  page.on("popup", (popup) => void popup.close());
  await page.evaluate(() => {
    window.print = () => undefined;
  });

  await page.locator("[data-more]").click();
  await page.locator('.modal [data-tab="inventario"]').click();
  await page.locator("#startInventoryCount").click();
  // prod-1 = Coca-Cola 600 ml en el fixture; su existencia es 48.
  await page.locator('[data-count-product="prod-1"]').fill("46");
  await expect(page.locator('[data-diff-for="prod-1"]')).toContainText("-2");

  await page.locator("#applyInventoryCount").click();
  await page.locator('.modal [data-modal-action="Aplicar"]').click();

  await expect(page.locator("#toastRoot")).toContainText("Inventario ajustado");
  await expect(page.locator("#inventoryList")).toContainText("46 Pza");
  await expect(page.locator("#inventoryCountsHistory")).toContainText("1 ajustes");
});

test("el mes no se cierra solo y se puede reabrir si fue un error", async ({ page }) => {
  await page.locator("[data-more]").click();
  await page.locator('.modal [data-tab="reportes"]').click();
  await expect(page.locator("#monthClosingsList")).toContainText("Aún no hay meses cerrados.");

  await page.locator("#closeMonth").click();
  await page.locator('.modal [data-modal-action="Continuar"]').click();
  await page.locator("#confirmKeyword").fill("CERRAR MES");
  await page.locator('.modal [data-modal-action="Cerrar mes"]').click();
  await expect(page.locator("#toastRoot")).toContainText("cerrado");
  await expect(page.locator("#monthReportSummary")).toContainText("Este mes está cerrado.");

  await page.locator('#monthReportSummary [data-reopen]').click();
  await page.locator('.modal [data-modal-action="Reabrir"]').click();
  await expect(page.locator("#toastRoot")).toContainText("reabierto");
  await expect(page.locator("#monthReportSummary")).not.toContainText("Este mes está cerrado.");
  await expect(page.locator("#monthClosingsList")).toContainText("Aún no hay meses cerrados.");
  await expect(page.locator("#closeMonth")).toHaveText("Cerrar mes");
});

test("Inicio muestra productos con rotación que están en su mínimo", async ({ page }) => {
  await expect(page.locator("#rotationCard")).toContainText("Se venden y están por agotarse");
  await expect(page.locator("#rotationCard")).toContainText("Sabritas Original 45 g");
  await expect(page.locator("#rotationCard")).toContainText("Stock 5 · Mín 6");
});

test("las tarjetas del inicio no desbordan su contenido", async ({ page }) => {
  for (const [width, height] of [[1440, 960], [1366, 768], [1280, 800], [1024, 768], [768, 1024], [390, 844], [360, 740]] as const) {
    await page.setViewportSize({ width, height });
    await prepare(page);
    const overflowing = await page.evaluate(() =>
      [...document.querySelectorAll<HTMLElement>(".dash .card")]
        .filter((card) => card.scrollWidth > card.clientWidth + 1)
        .map((card) => card.id || card.className)
    );
    const pageOverflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
    expect(overflowing, `tarjetas desbordadas a ${width}px`).toEqual([]);
    expect(pageOverflow, `scroll horizontal a ${width}px`).toBe(false);
  }
});
