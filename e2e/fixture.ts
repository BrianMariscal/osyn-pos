import { expect, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";

const fixture = JSON.parse(readFileSync("e2e/fixtures/demo-state.json", "utf8")) as {
  state: unknown;
  session: unknown;
};

/**
 * Arranca la app con una sesión de dueño simulada y un estado de ejemplo.
 * Supabase se intercepta: las pruebas no tocan la nube ni datos reales.
 */
export async function prepare(page: Page): Promise<void> {
  await page.addInitScript((session) => {
    localStorage.setItem("abarrotes-pos-auth-v2", JSON.stringify(session));
  }, fixture.session);
  await page.route("**/rest/v1/**", (route) => {
    if (route.request().url().includes("/profiles")) {
      return route.fulfill({ json: [{ role: "dueno", name: "Brian", branch_id: null }] });
    }
    return route.fulfill({ json: [] });
  });
  await page.route("**/auth/v1/**", (route) => route.fulfill({ json: {} }));

  await page.goto("/");
  await page.evaluate(async (state) => {
    await new Promise<void>((resolve, reject) => {
      const req = indexedDB.open("keyval-store");
      req.onupgradeneeded = () => req.result.createObjectStore("keyval");
      req.onsuccess = () => {
        const db = req.result;
        const tx = db.transaction("keyval", "readwrite");
        tx.objectStore("keyval").put(state, "abarrotes-pos-state-v3:demo-user");
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      };
      req.onerror = () => reject(req.error);
    });
  }, fixture.state);

  await page.reload();
  await expect(page.locator("#appShell")).not.toHaveClass(/hidden/, { timeout: 15_000 });
  await page.waitForTimeout(800);
}
