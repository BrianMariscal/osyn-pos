/**
 * Genera un estado de ejemplo para pruebas E2E y capturas de diseño.
 * Uso: npx vite-node scripts/demo-fixture.ts
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { Store } from "../src/domain/store";
import { createInitialState } from "../src/domain/app-state";
import { ChangeTracker } from "../src/data/change-tracker";
import { Repositories } from "../src/data/repositories";
import { BranchService } from "../src/domain/branch-service";
import { SettingsService } from "../src/domain/settings-service";
import { DEFAULT_BRANCH_ID, type AuthSession, type PaymentMethod, type Product, type Sale } from "../src/core/types";
import type { AuthService } from "../src/domain/auth-service";
import { nowISO } from "../src/core/dates";
import { uid } from "../src/core/id";

const auth = {
  isAdmin: () => true,
  isOwner: () => true,
  assignedBranchId: () => null
} as unknown as AuthService;

const store = new Store(createInitialState());
const repos = new Repositories(store, new ChangeTracker());
const branches = new BranchService(store, auth, repos, new SettingsService(store, new ChangeTracker()));
branches.ensureSeeded();
store.update((state) => {
  state.currentBranchId = DEFAULT_BRANCH_ID;
  state.settings.storeName = "Abarrotes La Esperanza";
  state.settings.assistantName = "OSYN";
});

const ts = nowISO();
const branch = DEFAULT_BRANCH_ID;

const suppliers = [
  { id: "sup-coca", number: 1, name: "Coca-Cola FEMSA", type: "Refrescos", phone: "555 123 4567", notes: "Visita martes", updated_at: ts },
  { id: "sup-sabritas", number: 2, name: "Sabritas", type: "Botanas", phone: "555 765 4321", notes: "Viernes", updated_at: ts },
  { id: "sup-central", number: 3, name: "Central de Abastos", type: "Abarrotes", phone: "", notes: "Compra local", updated_at: ts }
];
suppliers.forEach((supplier) => repos.suppliers.upsert(supplier));

const catalog: Array<[string, string, string, number, number, number, string, string?]> = [
  ["Coca-Cola 600 ml", "Refrescos", "sup-coca", 13, 18, 48, "Pza", "7501055300017"],
  ["Coca-Cola 2 L", "Refrescos", "sup-coca", 24, 34, 24, "Pza"],
  ["Sprite 600 ml", "Refrescos", "sup-coca", 13, 18, 30, "Pza"],
  ["Agua Ciel 1 L", "Refrescos", "sup-coca", 8, 14, 40, "Pza"],
  ["Sabritas Original 45 g", "Botanas", "sup-sabritas", 11, 17, 36, "Pza", "7501011100017"],
  ["Doritos Nacho 45 g", "Botanas", "sup-sabritas", 11, 17, 28, "Pza"],
  ["Galletas Emperador", "Galletas", "sup-central", 9, 15, 22, "Pza"],
  ["Pan Bimbo Blanco", "Pan", "sup-central", 32, 44, 12, "Pza"],
  ["Leche Lala 1 L", "Lácteos", "sup-central", 20, 27, 18, "Pza", "7501020500015"],
  ["Yogurt Danone 900 g", "Lácteos", "sup-central", 28, 39, 8, "Pza"],
  ["Huevo San Juan 12 pzas", "Abarrotes", "sup-central", 38, 48, 15, "Pza"],
  ["Arroz Verde Valle 1 kg", "Abarrotes", "sup-central", 24, 33, 20, "Pza"],
  ["Frijol Negro 1 kg", "Abarrotes", "sup-central", 26, 36, 16, "Pza"],
  ["Aceite Nutrioli 1 L", "Abarrotes", "sup-central", 34, 46, 10, "Pza"],
  ["Azúcar 1 kg", "Abarrotes", "sup-central", 22, 30, 14, "Pza"],
  ["Sal de Mesa 1 kg", "Abarrotes", "sup-central", 8, 14, 9, "Pza"],
  ["Jabón Zote 200 g", "Limpieza", "sup-central", 12, 19, 17, "Pza"],
  ["Cloro Cloralex 1 L", "Limpieza", "sup-central", 14, 22, 11, "Pza"],
  ["Papel Higiénico 4 rollos", "Limpieza", "sup-central", 28, 42, 13, "Pza"],
  ["Marlboro Rojo", "Cigarros", "sup-central", 70, 85, 25, "Pza"],
  ["Tecate Lata 355 ml", "Cerveza", "sup-coca", 17, 24, 40, "Pza"],
  ["Modelo Especial 355 ml", "Cerveza", "sup-coca", 22, 30, 36, "Pza"],
  ["Jitomate Saladet", "Frutas y verduras", "sup-central", 18, 26, 12, "Kg"],
  ["Plátano Tabasco", "Frutas y verduras", "sup-central", 14, 22, 0, "Kg"]
];

const products: Product[] = catalog.map(([name, category, supplier_id, cost, price, stock, um, barcode], index) => {
  const product: Product = {
    id: `prod-${index + 1}`,
    name,
    category,
    um: um as Product["um"],
    cost,
    price,
    supplier_id,
    barcode,
    active: true,
    created_at: ts,
    updated_at: ts
  };
  repos.products.upsert(product);
  repos.stocks.upsert({
    id: `${product.id}:${branch}`,
    product_id: product.id,
    branch_id: branch,
    stock,
    min_stock: um === "Kg" ? 3 : 6,
    updated_at: ts
  });
  return product;
});

repos.customers.upsert({
  id: "cli-1",
  branch_id: branch,
  name: "María López",
  phone: "555 111 2233",
  notes: "Casa azul de la esquina",
  balance: 185.5,
  movements: [],
  created_at: ts,
  updated_at: ts
});
repos.customers.upsert({
  id: "cli-2",
  branch_id: branch,
  name: "José Ramírez",
  phone: "",
  notes: "",
  balance: 60,
  movements: [],
  created_at: ts,
  updated_at: ts
});

const payments: PaymentMethod[] = ["efectivo", "efectivo", "efectivo", "tarjeta", "transferencia", "fiado"];
const saleAt = (daysAgo: number, hour: number): string => {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate() - daysAgo, hour, 0, 0).toISOString();
};

let saleNumber = 0;
for (let daysAgo = 13; daysAgo >= 0; daysAgo -= 1) {
  const count = daysAgo === 0 ? 6 : 8 + (daysAgo % 4);
  for (let i = 0; i < count; i += 1) {
    const itemCount = 1 + ((i + daysAgo) % 3);
    const items = [];
    let total = 0;
    let cost = 0;
    for (let j = 0; j < itemCount; j += 1) {
      const product = products[(i * 3 + j * 5 + daysAgo) % products.length]!;
      const qty = 1 + (j % 2);
      items.push({
        productId: product.id,
        name: product.name,
        qty,
        price: product.price,
        cost: product.cost,
        um: product.um,
        group: "general" as const
      });
      total += product.price * qty;
      cost += product.cost * qty;
    }
    const payment = payments[(saleNumber + daysAgo) % payments.length]!;
    const createdAt = saleAt(daysAgo, 9 + (i % 10));
    const sale: Sale = {
      id: uid(),
      branch_id: branch,
      items,
      total: Math.round(total * 100) / 100,
      cost: Math.round(cost * 100) / 100,
      profit: Math.round((total - cost) * 100) / 100,
      payment,
      customer_id: payment === "fiado" ? "cli-1" : null,
      cashier: "Brian",
      created_at: createdAt,
      updated_at: createdAt
    };
    repos.sales.upsert(sale);
    saleNumber += 1;
  }
}

const today = saleAt(0, 10).slice(0, 10);
[
  { id: "exp-renta", concept: "Renta del local", amount: 9500, category: "Renta", kind: "fijo" as const, period: "mensual" as const },
  { id: "exp-luz", concept: "Luz CFE", amount: 1450, category: "Luz", kind: "fijo" as const, period: "mensual" as const },
  { id: "exp-sueldos", concept: "Sueldo ayudante", amount: 1800, category: "Sueldos", kind: "fijo" as const, period: "semanal" as const },
  { id: "exp-extra", concept: "Garrafón de agua", amount: 45, category: "Varios", kind: "extra" as const }
].forEach((expense) => {
  repos.expenses.upsert({
    id: expense.id,
    branch_id: branch,
    concept: expense.concept,
    amount: expense.amount,
    category: expense.category,
    kind: expense.kind,
    ...(expense.kind === "fijo" ? { period: expense.period } : {}),
    created_at: today ? `${today}T09:00:00.000Z` : ts,
    updated_at: ts
  });
});

const session: AuthSession = {
  access_token: "demo",
  refresh_token: "demo",
  expires_at: Math.floor(Date.now() / 1000) + 31_536_000,
  user: { id: "demo-user", email: "demo@osyn.mx" },
  role: "dueno",
  name: "Brian",
  branch_id: null
};

mkdirSync("e2e/fixtures", { recursive: true });
writeFileSync("e2e/fixtures/demo-state.json", JSON.stringify({ state: store.getState(), session }, null, 2));
console.log(`Fixture generado: ${store.getState().products.length} productos, ${store.getState().sales.length} ventas`);
