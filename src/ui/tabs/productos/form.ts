import { html, setHtml } from "../../../core/html";
import { nowISO } from "../../../core/dates";
import { uid } from "../../../core/id";
import { normalizeQty } from "../../../core/qty";
import { type Product, type SaleGroup, type Unit } from "../../../core/types";
import { isBulkUnit } from "../../../core/units";
import { supplierLabel } from "../../../domain/catalog";
import { mountCategoryField } from "../../category-field";
import { scanBarcode } from "../../scanner";
import type { ProductFilters } from "../../product-filters";
import type { ProductosScene } from "./scene";

/** Formulario de producto: alta, edición y catálogo de proveedores. */
export interface ProductForm {
  renderSupplierOptions(): void;
  resetForm(): void;
  startEdit(product: Product): void;
  editingId(): string;
  /** Relee las categorías del catálogo (al redibujar la lista). */
  refreshCategories(): void;
}

export function createProductForm(scene: ProductosScene, filters: ProductFilters): ProductForm {
  const { ctx, root, sections, stockRowFor } = scene;
  const form = root.querySelector<HTMLFormElement>("#productForm")!;
  const formTitle = root.querySelector<HTMLElement>("#productFormTitle")!;
  const idInput = root.querySelector<HTMLInputElement>("#productId")!;
  const nameInput = root.querySelector<HTMLInputElement>("#productName")!;
  const category = mountCategoryField(root, "productCategory", ctx);
  const unitInput = root.querySelector<HTMLSelectElement>("#productUnit")!;
  const costInput = root.querySelector<HTMLInputElement>("#productCost")!;
  const priceInput = root.querySelector<HTMLInputElement>("#productPrice")!;
  const costUnitLabel = root.querySelector<HTMLElement>("#productCostUnit")!;
  const priceUnitLabel = root.querySelector<HTMLElement>("#productPriceUnit")!;
  const priceHint = root.querySelector<HTMLElement>("#productPriceHint")!;
  const supplierInput = root.querySelector<HTMLSelectElement>("#productSupplier")!;
  const packInput = root.querySelector<HTMLInputElement>("#productPack")!;
  const packPriceInput = root.querySelector<HTMLInputElement>("#productPackPrice")!;
  const groupInput = root.querySelector<HTMLSelectElement>("#productGroup")!;
  const stockInput = root.querySelector<HTMLInputElement>("#productStock")!;
  const minInput = root.querySelector<HTMLInputElement>("#productMin")!;
  const barcodeInput = root.querySelector<HTMLInputElement>("#productBarcode")!;
  const cancelEdit = root.querySelector<HTMLButtonElement>("#productCancel")!;
  const formBox = root.querySelector<HTMLDetailsElement>("#productFormBox")!;
  /** Existencia mostrada al empezar a editar: solo se guarda si el usuario la cambió. */
  let stockAtEdit: string | null = null;

  /**
   * Aclara que en productos a granel el costo/precio son por unidad base
   * (Kg, Gr, Lts) y avisa del error típico: precio "por kilo" con unidad Gr.
   */
  const syncUnitLabels = (): void => {
    const unit = unitInput.value as Unit;
    const bulk = isBulkUnit(unit);
    costUnitLabel.textContent = bulk ? `(por ${unit})` : "";
    priceUnitLabel.textContent = bulk ? `(por ${unit})` : "";
    const price = Number(priceInput.value || 0);
    priceHint.classList.toggle("hidden", !(unit === "Gr" && price >= 1));
  };
  unitInput.addEventListener("change", syncUnitLabels);
  priceInput.addEventListener("input", syncUnitLabels);
  syncUnitLabels();

  const sortedSuppliers = () =>
    ctx.repos.suppliers.list().sort((a, b) => (a.number ?? 0) - (b.number ?? 0) || a.name.localeCompare(b.name));

  const renderSupplierOptions = (): void => {
    const suppliers = sortedSuppliers();
    const formValue = supplierInput.value;
    setHtml(
      supplierInput,
      html`<option value="">Sin proveedor</option>${suppliers.map(
        (s) => html`<option value="${s.id}" ${s.id === formValue ? "selected" : null}>${supplierLabel(s)}</option>`
      )}`
    );
    filters.refresh();
  };

  const resetForm = (): void => {
    form.reset();
    category.set("Abarrotes");
    idInput.value = "";
    stockAtEdit = null;
    cancelEdit.hidden = true;
    minInput.value = "2";
    stockInput.disabled = false;
    formTitle.textContent = "Nuevo producto";
    syncUnitLabels();
  };

  // Al elegir proveedor se sugiere su giro como categoría (si no se ha elegido otra).
  supplierInput.addEventListener("change", () => {
    const supplier = ctx.repos.suppliers.byId(supplierInput.value);
    if (supplier?.type && category.isDefault()) category.set(supplier.type);
  });

  root.querySelector<HTMLButtonElement>("#barcodeScan")!.addEventListener("click", async () => {
    try {
      const code = await scanBarcode();
      if (code) barcodeInput.value = code;
    } catch (error) {
      ctx.toast(error instanceof Error ? error.message : "No se pudo escanear");
    }
  });

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const ts = nowISO();
    const id = idInput.value || uid();
    const existing = ctx.repos.products.byId(id);
    const name = nameInput.value.trim();
    const price = Number(priceInput.value || 0);
    if (!name || !(price > 0)) {
      ctx.toast("Nombre y precio son obligatorios");
      return;
    }
    const barcode = barcodeInput.value.trim();
    if (barcode && ctx.repos.products.list().some((p) => p.id !== id && p.barcode?.trim() === barcode)) {
      ctx.toast("Ese código de barras ya pertenece a otro producto");
      return;
    }
    const packSize = Math.round(normalizeQty(packInput.value));
    const packPrice = Math.round(Math.max(0, Number(packPriceInput.value || 0)) * 100) / 100;
    if (packPrice > 0 && packSize <= 1) {
      ctx.toast("Para vender por caja indica cuántas piezas trae la caja");
      return;
    }
    const product: Product = {
      // Conserva campos que este formulario no edita
      ...(existing && !existing.deleted ? existing : {}),
      id,
      name,
      category: category.get(),
      um: (unitInput.value as Unit) ?? "Pza",
      cost: Math.max(0, Number(costInput.value || 0)),
      price,
      barcode: barcode || undefined,
      supplier_id: supplierInput.value || undefined,
      pack_size: packSize > 1 ? packSize : undefined,
      pack_price: packSize > 1 && packPrice > 0 ? packPrice : undefined,
      sale_group: (groupInput.value as SaleGroup) || undefined,
      active: existing?.active !== false,
      deleted: false,
      created_at: existing?.created_at ?? ts,
      updated_at: ts
    };
    ctx.repos.products.upsert(product);
    const current = stockRowFor(id);
    // Al editar, la existencia solo se reescribe si el usuario la cambió:
    // así no se pierden las ventas hechas mientras el formulario estaba abierto.
    const stockChanged = stockAtEdit === null || stockInput.value !== stockAtEdit;
    const minValue = normalizeQty(minInput.value);
    // Sin cambios en existencia ni mínimo no se reescribe la fila: subirla
    // pisaría ventas recientes que el servidor aún no ha descontado.
    if (current && !stockChanged && normalizeQty(current.min_stock) === minValue) {
      resetForm();
      if (existing) {
        formBox.open = false;
        sections.show("lista");
      }
      ctx.toast(existing ? "Producto actualizado" : "Producto guardado");
      return;
    }
    ctx.repos.stocks.upsert({
      id: current?.id ?? `${id}:${ctx.branches.operationalId()}`,
      product_id: id,
      branch_id: ctx.branches.operationalId(),
      stock: stockChanged || !current ? normalizeQty(stockInput.value) : current.stock,
      min_stock: minValue,
      updated_at: ts
    });
    resetForm();
    if (existing) {
      formBox.open = false;
      sections.show("lista");
    }
    ctx.toast(existing ? "Producto actualizado" : "Producto guardado");
  });

  cancelEdit.addEventListener("click", () => {
    resetForm();
    formBox.open = false;
    sections.show("lista");
  });

  root.querySelector<HTMLButtonElement>("#newProductToggle")!.addEventListener("click", () => {
    if (idInput.value) resetForm();
    sections.show("nuevo");
    formBox.open = true;
    formBox.scrollIntoView({ behavior: "smooth", block: "start" });
    nameInput.focus({ preventScroll: true });
  });

  /** Lleva el producto al formulario para editarlo. */
  const startEdit = (product: Product): void => {
    idInput.value = product.id;
    nameInput.value = product.name;
    category.set(product.category ?? "");
    unitInput.value = product.um;
    costInput.value = String(product.cost ?? 0);
    priceInput.value = String(product.price ?? 0);
    renderSupplierOptions();
    supplierInput.value = product.supplier_id && ctx.repos.suppliers.byId(product.supplier_id) ? product.supplier_id : "";
    packInput.value = product.pack_size ? String(product.pack_size) : "";
    packPriceInput.value = product.pack_price ? String(product.pack_price) : "";
    groupInput.value = product.sale_group ?? "";
    const stock = stockRowFor(product.id);
    stockInput.value = String(stock?.stock ?? 0);
    stockAtEdit = stockInput.value;
    minInput.value = String(stock?.min_stock ?? 0);
    barcodeInput.value = product.barcode ?? "";
    cancelEdit.hidden = false;
    formTitle.textContent = `Editando: ${product.name}`;
    syncUnitLabels();
    sections.show("nuevo");
    formBox.open = true;
    formBox.scrollIntoView({ behavior: "smooth", block: "start" });
    nameInput.focus({ preventScroll: true });
  };

  return { renderSupplierOptions, resetForm, startEdit, editingId: () => idInput.value, refreshCategories: () => category.refresh() };
}
