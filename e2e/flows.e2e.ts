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
