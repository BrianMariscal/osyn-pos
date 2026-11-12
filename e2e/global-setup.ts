import { execSync } from "node:child_process";

/** Regenera el estado de ejemplo con fechas relativas a hoy antes de las pruebas. */
export default function globalSetup(): void {
  execSync("npx vite-node scripts/demo-fixture.ts", { stdio: "inherit" });
}
