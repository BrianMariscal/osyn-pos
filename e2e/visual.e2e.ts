import { test } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { prepare } from "./fixture";

mkdirSync("e2e/fixtures/shots", { recursive: true });

test("captura de pantallas del producto (escritorio)", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 960 });
  await prepare(page);
  await page.screenshot({ path: "e2e/fixtures/shots/01-inicio.png", fullPage: true });

  await page.locator('[data-tab="venta"]').click();
  await page.waitForTimeout(400);
  await page.screenshot({ path: "e2e/fixtures/shots/02-venta.png", fullPage: true });

  await page.locator("#productSearch").fill("coca");
  await page.waitForTimeout(300);
  await page.screenshot({ path: "e2e/fixtures/shots/03-venta-busqueda.png", fullPage: true });

  await page.locator("[data-result]").first().click();
  await page.locator("#productSearch").fill("sabritas");
  await page.waitForTimeout(250);
  await page.locator("[data-result]").first().click();
  await page.locator("#productSearch").fill("leche");
  await page.waitForTimeout(250);
  await page.locator("[data-result]").first().click();
  await page.locator("#cashReceived").fill("200");
  await page.waitForTimeout(300);
  await page.screenshot({ path: "e2e/fixtures/shots/04-venta-carrito.png", fullPage: true });

  await page.locator('[data-tab="corte"]').click();
  await page.waitForTimeout(400);
  await page.screenshot({ path: "e2e/fixtures/shots/05-corte.png", fullPage: true });

  await page.locator('[data-tab="fiado"]').click();
  await page.waitForTimeout(350);
  await page.screenshot({ path: "e2e/fixtures/shots/09-fiado.png", fullPage: true });

  for (const [tab, file] of [
    ["productos", "10-productos"],
    ["inventario", "11-inventario"],
    ["reportes", "12-reportes"],
    ["ajustes", "13-ajustes"]
  ] as const) {
    await page.locator("[data-more]").click();
    await page.locator(`.modal [data-tab="${tab}"]`).click();
    await page.waitForTimeout(400);
    await page.screenshot({ path: `e2e/fixtures/shots/${file}.png`, fullPage: true });
  }
});

test("captura de pantallas del producto (móvil)", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await prepare(page);
  await page.screenshot({ path: "e2e/fixtures/shots/06-movil-inicio.png" });
  await page.locator('[data-tab="venta"]').click();
  await page.waitForTimeout(400);
  await page.screenshot({ path: "e2e/fixtures/shots/06-movil-venta.png" });
  await page.locator(".quick-item").first().click();
  await page.waitForTimeout(300);
  await page.screenshot({ path: "e2e/fixtures/shots/07-movil-carrito.png" });
  await page.locator("#payPanel").scrollIntoViewIfNeeded();
  await page.waitForTimeout(300);
  await page.screenshot({ path: "e2e/fixtures/shots/08-movil-cobro.png" });
});

test("captura del acceso", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  await page.locator("#loginEmail").waitFor({ timeout: 15_000 });
  await page.screenshot({ path: "e2e/fixtures/shots/00-acceso.png" });
});
