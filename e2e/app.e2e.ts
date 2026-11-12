import { expect, test } from "@playwright/test";

/**
 * Humo de arranque: la app carga, muestra el acceso y la segunda pestaña
 * queda bloqueada por el candado de instancia única.
 */
test("muestra la pantalla de acceso", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("#loginEmail")).toBeVisible();
  await expect(page.getByRole("heading", { name: "OSYN POS" })).toBeVisible();
});

test("una segunda pestaña no puede operar la misma tienda", async ({ context }) => {
  const first = await context.newPage();
  await first.goto("/");
  await expect(first.locator("#loginEmail")).toBeVisible();

  const second = await context.newPage();
  await second.goto("/");
  await expect(second.getByText("OSYN POS ya está abierto")).toBeVisible();
  await expect(second.locator("#loginEmail")).toHaveCount(0);
});
