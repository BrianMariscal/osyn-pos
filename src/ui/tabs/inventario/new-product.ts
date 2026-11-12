import { nowISO } from "../../../core/dates";
import { html } from "../../../core/html";
import { uid } from "../../../core/id";
import { normalizeQty } from "../../../core/qty";
import { UNITS, type Product, type Unit } from "../../../core/types";
import { isBulkUnit } from "../../../core/units";
import { supplierLabel } from "../../../domain/catalog";
import { categoryFieldMarkup, mountCategoryField, type CategoryField } from "../../category-field";
import { openModal } from "../../components/modal";
import type { AppContext } from "../../context";
import { iconFor } from "../../icons";
import { scanBarcode } from "../../scanner";

export interface NewProductPreset {
  supplierId?: string;
  barcode?: string;
}

/** Modal de alta rápida de producto (Inventario, Proveedores y código no registrado en Venta). */
export function openNewProductModal(ctx: AppContext, onDone: (product: Product) => void, preset: NewProductPreset = {}): void {
  let category: CategoryField | null = null;
  const suppliers = ctx.repos.suppliers.list().sort((a, b) => (a.number ?? 0) - (b.number ?? 0) || a.name.localeCompare(b.name));

  /** Crea el producto y, si `again`, deja el modal listo para el siguiente. */
  const save = (close: () => void, again: boolean): void => {
    const value = (id: string): string => (document.getElementById(id) as HTMLInputElement).value.trim();
    const name = value("pName");
    const price = Number(value("pPrice") || 0);
    if (!name || !(price > 0)) {
      ctx.toast("Nombre y precio son obligatorios");
      return;
    }
    const barcode = value("pBarcode");
    if (barcode && ctx.repos.products.list().some((p) => p.barcode?.trim() === barcode)) {
      ctx.toast("Ese código ya pertenece a otro producto");
      return;
    }
    const ts = nowISO();
    const packSize = Math.round(normalizeQty(value("pPack")));
    const product: Product = {
      id: uid(),
      name,
      category: category?.get() ?? "",
      um: (document.getElementById("pUnit") as HTMLSelectElement).value as Unit,
      cost: Math.max(0, Number(value("pCost") || 0)),
      price,
      barcode: barcode || undefined,
      supplier_id: value("pSupplier") || undefined,
      pack_size: packSize > 1 ? packSize : undefined,
      active: true,
      created_at: ts,
      updated_at: ts
    };
    ctx.repos.products.upsert(product);
    const branchId = ctx.branches.operationalId();
    ctx.repos.stocks.upsert({
      id: `${product.id}:${branchId}`,
      product_id: product.id,
      branch_id: branchId,
      stock: normalizeQty(value("pStock")),
      min_stock: normalizeQty(value("pMin")),
      updated_at: ts
    });
    onDone(product);
    if (!again) {
      close();
      ctx.toast(`${name} creado`);
      return;
    }
    // Se conservan categoría, unidad y proveedor para capturar varios seguidos.
    for (const id of ["pName", "pCost", "pPrice", "pBarcode", "pPack", "pStock"]) {
      const input = document.getElementById(id) as HTMLInputElement | null;
      if (input) input.value = id === "pStock" ? "0" : "";
    }
    const min = document.getElementById("pMin") as HTMLInputElement | null;
    if (min) min.value = "2";
    (document.getElementById("pName") as HTMLInputElement | null)?.focus();
    ctx.toast(`${name} creado. Captura el siguiente.`);
  };

  openModal({
    title: "Nuevo producto",
    content: html`
      ${preset.barcode ? html`<p class="muted">El código ${preset.barcode} no está registrado. Captura el producto para agregarlo.</p>` : html``}
      <label class="form-field">Nombre
        <input id="pName" class="input" required>
      </label>
      <div class="row">
        ${categoryFieldMarkup("pCategory")}
        <label class="form-field">Unidad
          <select id="pUnit" class="input">
            ${UNITS.map((unit) => html`<option value="${unit}">${unit}</option>`)}
          </select>
        </label>
      </div>
      <div class="row">
        <label class="form-field">Costo <span id="pCostUnit" class="muted"></span>
          <input id="pCost" class="input" type="number" step="0.01" min="0" inputmode="decimal">
        </label>
        <label class="form-field">Precio de venta <span id="pPriceUnit" class="muted"></span>
          <input id="pPrice" class="input" type="number" step="0.01" min="0" inputmode="decimal" required>
        </label>
      </div>
      <p id="pPriceHint" class="hint hidden">Con la unidad Gr el precio se cobra POR GRAMO. Si cobras por kilo, usa la unidad Kg.</p>
      <div class="row">
        <label class="form-field">Proveedor
          <select id="pSupplier" class="input">
            <option value="">Sin proveedor</option>
            ${suppliers.map((s) => html`<option value="${s.id}" ${s.id === preset.supplierId ? "selected" : null}>${supplierLabel(s)}</option>`)}
          </select>
        </label>
        <label class="form-field">Piezas por caja
          <input id="pPack" class="input" type="number" step="1" min="0" inputmode="numeric" placeholder="Opcional">
        </label>
      </div>
      <div class="search-row">
        <label class="form-field">Código de barras / QR (opcional)
          <input id="pBarcode" class="input" inputmode="numeric" value="${preset.barcode ?? ""}">
        </label>
        <button id="pScan" class="ghost align-end" type="button">${iconFor("barcode")} Escanear</button>
      </div>
      <div class="row">
        <label class="form-field">Existencia inicial (esta sucursal)
          <input id="pStock" class="input" type="number" step="0.01" min="0" value="0" inputmode="decimal">
        </label>
        <label class="form-field">Mínimo
          <input id="pMin" class="input" type="number" step="0.01" min="0" value="2" inputmode="decimal">
        </label>
      </div>
    `,
    actions: [
      { label: "Cancelar", kind: "ghost", onClick: (close) => close() },
      { label: "Crear producto", kind: "primary", onClick: (close) => save(close, false) },
      ...(preset.barcode
        ? []
        : [{ label: "Crear y otro", kind: "ghost" as const, onClick: (close: () => void) => save(close, true) }])
    ],
    onOpen: (modalRoot) => {
      const presetSupplier = preset.supplierId ? ctx.repos.suppliers.byId(preset.supplierId) : undefined;
      category = mountCategoryField(modalRoot, "pCategory", ctx);
      if (presetSupplier?.type) category.set(presetSupplier.type);
      // A granel el precio es por unidad base (Kg, Gr, Lts): se avisa en la etiqueta
      const unitSelect = modalRoot.querySelector<HTMLSelectElement>("#pUnit");
      const priceField = modalRoot.querySelector<HTMLInputElement>("#pPrice");
      const syncLabels = (): void => {
        const unit = (unitSelect?.value ?? "Pza") as Unit;
        const bulk = isBulkUnit(unit);
        const costLabel = modalRoot.querySelector<HTMLElement>("#pCostUnit");
        const priceLabel = modalRoot.querySelector<HTMLElement>("#pPriceUnit");
        const hint = modalRoot.querySelector<HTMLElement>("#pPriceHint");
        if (costLabel) costLabel.textContent = bulk ? `(por ${unit})` : "";
        if (priceLabel) priceLabel.textContent = bulk ? `(por ${unit})` : "";
        hint?.classList.toggle("hidden", !(unit === "Gr" && Number(priceField?.value || 0) >= 1));
      };
      unitSelect?.addEventListener("change", syncLabels);
      priceField?.addEventListener("input", syncLabels);
      syncLabels();
      modalRoot.querySelector<HTMLSelectElement>("#pSupplier")?.addEventListener("change", (event) => {
        const supplier = ctx.repos.suppliers.byId((event.target as HTMLSelectElement).value);
        if (supplier?.type && category?.isDefault()) category.set(supplier.type);
      });
      modalRoot.querySelector<HTMLButtonElement>("#pScan")?.addEventListener("click", async () => {
        try {
          const code = await scanBarcode();
          if (code) (document.getElementById("pBarcode") as HTMLInputElement).value = code;
        } catch (error) {
          ctx.toast(error instanceof Error ? error.message : "No se pudo escanear");
        }
      });
      if (preset.barcode) modalRoot.querySelector<HTMLInputElement>("#pName")?.focus();
    }
  });
}
