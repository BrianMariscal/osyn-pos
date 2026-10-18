import { html, setHtml } from "../../core/html";
import { nowISO } from "../../core/dates";
import { uid } from "../../core/id";
import { fmtMoneyPesos } from "../../core/money";
import { fmtDateTime } from "../../core/dates";
import type { CustomerMovement } from "../../core/types";
import { confirmDialog, openModal, promptDialog } from "../components/modal";
import { openWhatsapp } from "../whatsapp";
import { plainText } from "../../domain/catalog";
import { mountSections } from "../sections";
import { paginate, pagerClick, pagerMarkup } from "../pager";
import type { TabModule } from "./tab-module";

export const fiadoTab: TabModule = {
  id: "fiado",
  render(root, ctx) {
    setHtml(
      root,
      html`
        <div class="split">
          <article class="card">
            <h2>Clientes de fiado</h2>
            <form id="customerForm" class="form">
              <input id="customerName" class="input" placeholder="Nombre del cliente" required>
              <input id="customerPhone" class="input" type="tel" placeholder="Teléfono (opcional)">
              <input id="customerNotes" class="input" placeholder="Domicilio / referencias (opcional)">
              <button class="primary" type="submit">Agregar cliente</button>
            </form>
          </article>
          <article class="card">
            <h2>Saldos</h2>
            <p class="hint" id="creditTotal"></p>
            <input id="customerSearch" class="input" type="search" placeholder="Buscar cliente" autocomplete="off">
            <div id="customersList" class="list"></div>
          </article>
        </div>
      `
    );

    // En celular: una sección a la vez (en computadora van lado a lado)
    const articles = [...root.querySelectorAll<HTMLElement>(":scope > .split > article")];
    mountSections(root, [
      { id: "saldos", label: "Saldos", el: articles[1] ?? null },
      { id: "nuevo", label: "Nuevo cliente", el: articles[0] ?? null }
    ]);

    const form = root.querySelector<HTMLFormElement>("#customerForm")!;
    const nameInput = root.querySelector<HTMLInputElement>("#customerName")!;
    const phoneInput = root.querySelector<HTMLInputElement>("#customerPhone")!;
    const notesInput = root.querySelector<HTMLInputElement>("#customerNotes")!;
    const searchInput = root.querySelector<HTMLInputElement>("#customerSearch")!;
    const totalEl = root.querySelector<HTMLElement>("#creditTotal")!;
    const list = root.querySelector<HTMLElement>("#customersList")!;

    const customersOfBranch = (): string => ctx.branches.operationalId();
    let customerPage = 0;

    const render = (): void => {
      const all = ctx.repos.customers.list().filter((c) => c.branch_id === customersOfBranch());
      const owed = all.reduce((sum, c) => sum + Math.round(c.balance * 100), 0) / 100;
      totalEl.textContent = all.length ? `${all.filter((c) => c.balance > 0).length} clientes deben en total ${fmtMoneyPesos(owed)}` : "";
      const q = plainText(searchInput.value);
      const customers = all
        .filter((c) => !q || q.split(/\s+/).every((word) => plainText(c.name).includes(word)) || c.phone.replace(/\D/g, "").includes(q.replace(/\D/g, "") || "\u0000"))
        .sort((a, b) => b.balance - a.balance || a.name.localeCompare(b.name));
      if (!customers.length) {
        setHtml(list, html`<p class="muted">${all.length ? "Ningún cliente coincide." : "Agrega clientes para manejar el fiado, o fía desde Venta eligiendo \"Cliente nuevo\"."}</p>`);
        return;
      }
      const page = paginate(customers, customerPage, 10);
      setHtml(
        list,
        html`${page.items.map(
          (customer) => html`
            <div class="list-item ${customer.balance > 0 ? "" : "paid"}">
              <div class="item-line"><strong>${customer.name}</strong><strong>${fmtMoneyPesos(customer.balance)}</strong></div>
              <p class="muted">${customer.phone || "Sin teléfono"}${customer.notes ? ` · ${customer.notes}` : ""}</p>
              <div class="actions">
                <button class="ghost" type="button" data-pay="${customer.id}">Registrar pago</button>
                <button class="ghost" type="button" data-charge="${customer.id}">Fiar</button>
                <button class="ghost" type="button" data-edit-customer="${customer.id}">Editar</button>
                <button class="ghost" type="button" data-history="${customer.id}">Movimientos</button>
                ${ctx.auth.isAdmin() ? html`<button class="ghost danger" type="button" data-delete-customer="${customer.id}">Eliminar</button>` : html``}
                <button class="ghost" type="button" data-wa="${customer.id}">WhatsApp</button>
              </div>
            </div>
          `
        )}${pagerMarkup("customers", page)}`
      );
    };

    searchInput.addEventListener("input", () => {
      customerPage = 0;
      render();
    });

    form.addEventListener("submit", (event) => {
      event.preventDefault();
      if (!nameInput.value.trim()) {
        ctx.toast("Escribe el nombre del cliente");
        return;
      }
      const ts = nowISO();
      ctx.repos.customers.upsert({
        id: uid(),
        branch_id: customersOfBranch(),
        name: nameInput.value.trim(),
        phone: phoneInput.value.trim(),
        notes: notesInput.value.trim(),
        balance: 0,
        movements: [],
        created_at: ts,
        updated_at: ts
      });
      form.reset();
      ctx.toast("Cliente agregado");
    });

    const askAmount = async (title: string, message: string): Promise<number | null> => {
      const value = await promptDialog({
        title,
        message,
        type: "number",
        placeholder: "0.00",
        required: true,
        confirmLabel: "Aceptar"
      });
      if (value === null) return null;
      const amount = Number(value);
      return Number.isFinite(amount) && amount > 0 ? amount : null;
    };

    list.addEventListener("click", async (event) => {
      const paging = pagerClick(event);
      if (paging) {
        customerPage = paging.page;
        render();
        list.scrollIntoView({ behavior: "smooth", block: "start" });
        return;
      }
      const target = event.target as HTMLElement;
      const editCustomerButton = target.closest<HTMLElement>("[data-edit-customer]");
      if (editCustomerButton) {
        const customer = ctx.repos.customers.byId(editCustomerButton.dataset.editCustomer!);
        if (!customer) return;
        openModal({
          title: "Editar cliente",
          content: html`
            <label class="form-field">Nombre
              <input id="cName" class="input" value="${customer.name}">
            </label>
            <label class="form-field">Teléfono
              <input id="cPhone" class="input" type="tel" value="${customer.phone}">
            </label>
            <label class="form-field">Domicilio / referencias
              <input id="cNotes" class="input" value="${customer.notes ?? ""}">
            </label>
          `,
          actions: [
            { label: "Cancelar", kind: "ghost", onClick: (close) => close() },
            {
              label: "Guardar",
              kind: "primary",
              onClick: (close) => {
                const name = (document.getElementById("cName") as HTMLInputElement).value.trim();
                if (!name) {
                  ctx.toast("El nombre es obligatorio");
                  return;
                }
                ctx.repos.customers.upsert({
                  ...customer,
                  name,
                  phone: (document.getElementById("cPhone") as HTMLInputElement).value.trim(),
                  notes: (document.getElementById("cNotes") as HTMLInputElement).value.trim(),
                  updated_at: nowISO()
                });
                close();
                ctx.toast("Cliente actualizado");
              }
            }
          ]
        });
        return;
      }
      const deleteCustomerButton = target.closest<HTMLElement>("[data-delete-customer]");
      if (deleteCustomerButton) {
        const customer = ctx.repos.customers.byId(deleteCustomerButton.dataset.deleteCustomer!);
        if (!customer) return;
        const confirmed = await confirmDialog({
          title: "Eliminar cliente",
          message:
            customer.balance > 0
              ? `${customer.name} tiene saldo pendiente de ${fmtMoneyPesos(customer.balance)}. Se eliminará de todos modos.`
              : `Se eliminará a ${customer.name}.`,
          confirmLabel: "Eliminar",
          danger: true
        });
        if (!confirmed) return;
        ctx.repos.customers.softDelete(customer.id);
        ctx.toast("Cliente eliminado");
        return;
      }
      const payButton = target.closest<HTMLElement>("[data-pay]");
      if (payButton) {
        const customer = ctx.repos.customers.byId(payButton.dataset.pay!);
        if (!customer) return;
        const amount = await askAmount("Registrar pago", `Pago de ${customer.name} (saldo: ${fmtMoneyPesos(customer.balance)})`);
        if (amount === null) return;
        const result = ctx.credit.pay(customer.id, amount);
        if (!result.ok) {
          ctx.toast(result.error);
          return;
        }
        ctx.toast(result.warning ?? `Pago registrado a ${customer.name}`);
        return;
      }
      const chargeButton = target.closest<HTMLElement>("[data-charge]");
      if (chargeButton) {
        const customer = ctx.repos.customers.byId(chargeButton.dataset.charge!);
        if (!customer) return;
        const amount = await askAmount("Registrar fiado", `Cargo a ${customer.name}`);
        if (amount === null) return;
        const result = ctx.credit.charge(customer.id, amount, "Cargo manual");
        if (!result.ok) {
          ctx.toast(result.error);
          return;
        }
        ctx.toast(`Fiado registrado a ${customer.name}`);
        return;
      }
      const historyButton = target.closest<HTMLElement>("[data-history]");
      if (historyButton) {
        const customer = ctx.repos.customers.byId(historyButton.dataset.history!);
        if (!customer) return;
        const movements: CustomerMovement[] = customer.movements ?? [];
        openModal({
          title: `Movimientos de ${customer.name}`,
          content: html`
            ${movements.length
              ? html`<div class="list">${movements.slice(0, 30).map(
                  (movement) => html`
                    <div class="list-item item-line">
                      <div>
                        <strong>${movement.type === "cargo" ? "Cargo" : movement.type === "pago" ? "Pago" : "Devolución"}</strong>
                        <p class="muted">${movement.note} | ${fmtDateTime(movement.created_at)}</p>
                      </div>
                      <strong>${fmtMoneyPesos(movement.amount)}</strong>
                    </div>
                  `
                )}</div>`
              : html`<p class="muted">Sin movimientos.</p>`}
          `,
          actions: [{ label: "Cerrar", kind: "primary" }]
        });
        return;
      }
      const waButton = target.closest<HTMLElement>("[data-wa]");
      if (waButton) {
        const customer = ctx.repos.customers.byId(waButton.dataset.wa!);
        if (!customer) return;
        const phone = customer.phone || ctx.branches.shiftWhatsappNumbers(ctx.branches.operationalId())[0] || "";
        if (!phone) {
          ctx.toast("Falta número de WhatsApp");
          return;
        }
        openWhatsapp(phone, `Hola ${customer.name}, tu saldo pendiente en ${ctx.store.getState().settings.storeName} es ${fmtMoneyPesos(customer.balance)}.`);
      }
    });

    ctx.store.watch(
      (s) => [s.customers, s.branches, s.currentBranchId] as const,
      render
    );
    render();
  }
};
