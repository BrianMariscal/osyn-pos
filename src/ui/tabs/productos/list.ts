import { html, setHtml } from "../../../core/html";
import { nowISO } from "../../../core/dates";
import { fmtMoneyPesos } from "../../../core/money";
import { SALE_GROUP_LABELS, type Product } from "../../../core/types";
import { detectSaleGroup } from "../../../domain/sale-groups";
import { supplierCode } from "../../../domain/catalog";
import { confirmDialog } from "../../components/modal";
import { iconFor } from "../../icons";
import { paginate, pagerClick, pagerMarkup } from "../../pager";
import { wireScanToSearch } from "../../scan-field";
import type { ProductFilters } from "../../product-filters";
import { fmtQtySafe, type ProductosScene } from "./scene";
import type { ProductForm } from "./form";
import { openProductQr } from "./qr";

/** Lista de productos: búsqueda, filtros, grupos por categoría y acciones. */
export interface ProductList {
  render(): void;
  /** Con búsqueda o filtros: resultados directos desde la página 1. */
  onFiltersChanged(): void;
}

export function createProductList(scene: ProductosScene, filters: ProductFilters, form: ProductForm): ProductList {
  const { ctx, root, stockRowFor } = scene;
  const list = root.querySelector<HTMLElement>("#productsList")!;
  const hint = root.querySelector<HTMLElement>("#stockScopeHint")!;
  const listSearch = root.querySelector<HTMLInputElement>("#productsSearch")!;
  // Escanear en la lista: muestra el producto (y lo abre para ver sus datos)
  wireScanToSearch(ctx, root.querySelector<HTMLElement>("#productsScan")!, listSearch);
  const countEl = root.querySelector<HTMLElement>("#productsCount")!;
  const totalEl = root.querySelector<HTMLElement>("#productsTotal")!;
  /** Categorías y productos abiertos (se conservan al redibujar por sync). */
  const openGroups = new Set<string>();
  const openRows = new Set<string>();
  /** Página actual de cada lista ("all" = resultados de búsqueda, "g:<categoría>"). */
  const pages = new Map<string, number>();
  const PAGE_SEARCH = 10;
  const PAGE_GROUP = 8;
  let searchTimer: ReturnType<typeof setTimeout> | undefined;

  const render = (): void => {
    const branchName = ctx.branches.name(ctx.branches.operationalId());
    hint.textContent = `La existencia y el mínimo se guardan para: ${branchName}`;
    const all = ctx.repos.products.list();
    form.refreshCategories();
    filters.refresh();
    const suppliers = new Map(ctx.repos.suppliers.list().map((s) => [s.id, s]));
    const products = filters.apply(all, listSearch.value);
    totalEl.textContent = all.length ? String(all.length) : "";
    const filtering = Boolean(listSearch.value.trim()) || filters.active();
    countEl.textContent = filtering && all.length ? `${products.length} de ${all.length} productos` : "";
    if (!products.length) {
      setHtml(list, html`<p class="empty-note">${all.length ? "Ningún producto coincide." : "Aún no hay productos. Toca “Nuevo” para dar de alta el primero."}</p>`);
      return;
    }
    const row = (product: Product) => {
      const stock = stockRowFor(product.id);
      const qty = stock?.stock ?? 0;
      const low = qty <= (stock?.min_stock ?? 0);
      const supplier = product.supplier_id ? suppliers.get(product.supplier_id) : undefined;
      const group = detectSaleGroup(product);
      return html`
        <details class="row-item ${product.active === false ? "inactive" : ""}" data-product="${product.id}" ${openRows.has(product.id) ? "open" : null}>
          <summary>
            <span class="row-title"><strong>${product.name}</strong><small class="muted">${product.um}${product.barcode ? ` · ${product.barcode}` : ""}${product.active === false ? " · Oculto" : ""}</small></span>
            <span class="row-price">${fmtMoneyPesos(product.price)}</span>
            <span class="stock-pill" data-tone="${qty <= 0 ? "coral" : low ? "amber" : "green"}">${stock ? fmtQtySafe(qty) : "—"}</span>
          </summary>
          <div class="row-body">
            <p class="muted">${product.category || "Sin categoría"} · Costo ${fmtMoneyPesos(product.cost)} · Mínimo ${stock ? fmtQtySafe(stock.min_stock) : "—"}</p>
            <div class="tag-row">
              ${supplier ? html`<span class="tag">${supplierCode(supplier)} ${supplier.name}</span>` : html``}
              ${product.pack_size ? html`<span class="tag">Caja de ${product.pack_size}${product.pack_price ? ` · ${fmtMoneyPesos(product.pack_price)}` : ""}</span>` : html``}
              ${group !== "general" ? html`<span class="tag tag-accent">${SALE_GROUP_LABELS[group]}</span>` : html``}
            </div>
            <div class="actions">
              <button class="ghost" type="button" data-edit="${product.id}">${iconFor("edit")} Editar</button>
              <button class="ghost" type="button" data-qr="${product.id}">QR</button>
              <button class="ghost" type="button" data-hide="${product.id}">${product.active === false ? "Mostrar" : "Ocultar"}</button>
              <button class="ghost danger" type="button" data-delete="${product.id}">${iconFor("trash")} Eliminar</button>
            </div>
          </div>
        </details>
      `;
    };
    if (filtering) {
      // Con búsqueda o filtro: resultados directos, de 10 en 10
      const page = paginate(products, pages.get("all") ?? 0, PAGE_SEARCH);
      setHtml(list, html`<div class="list">${page.items.map(row)}</div>${pagerMarkup("all", page)}`);
      return;
    }
    // Sin búsqueda: agrupados por categoría, plegados; solo se dibujan los abiertos
    const groups = new Map<string, Product[]>();
    for (const product of products) {
      const key = product.category?.trim() || "Sin categoría";
      groups.set(key, [...(groups.get(key) ?? []), product]);
    }
    const ordered = [...groups.entries()].sort((a, b) => a[0].localeCompare(b[0], "es"));
    setHtml(
      list,
      html`${ordered.map(([name, items]) => {
        const lowCount = items.filter((p) => {
          const stock = stockRowFor(p.id);
          return (stock?.stock ?? 0) <= (stock?.min_stock ?? 0);
        }).length;
        const open = openGroups.has(name);
        const page = open ? paginate(items, pages.get(`g:${name}`) ?? 0, PAGE_GROUP) : null;
        return html`
          <details class="group-box" data-group="${name}" ${open ? "open" : null}>
            <summary>
              <strong>${name}</strong>
              <span class="tag">${items.length}</span>
              ${lowCount ? html`<span class="count-badge" data-tone="amber" title="Productos en o bajo el mínimo">${lowCount} ${lowCount === 1 ? "bajo" : "bajos"}</span>` : html``}
            </summary>
            ${page ? html`<div class="list">${page.items.map(row)}</div>${pagerMarkup(`g:${name}`, page)}` : html``}
          </details>
        `;
      })}`
    );
  };

  list.addEventListener("toggle", (event) => {
    const box = event.target as HTMLDetailsElement;
    if (box.dataset?.group !== undefined) {
      if (box.open) {
        // Solo una categoría abierta: abrir otra cierra la anterior
        openGroups.clear();
        openGroups.add(box.dataset.group);
        list.querySelectorAll<HTMLDetailsElement>("details.group-box[open]").forEach((other) => {
          if (other !== box) other.open = false;
        });
      } else openGroups.delete(box.dataset.group);
      // El contenido de la categoría se dibuja al abrirla
      if (box.open && !box.querySelector(".list")) render();
    } else if (box.dataset?.product) {
      if (box.open) openRows.add(box.dataset.product);
      else openRows.delete(box.dataset.product);
    }
  }, true);

  list.addEventListener("click", async (event) => {
    const target = event.target as HTMLElement;
    const paging = pagerClick(event);
    if (paging) {
      pages.set(paging.key, paging.page);
      openRows.clear();
      render();
      // Al cambiar de página se vuelve al inicio de esa lista
      const anchor = paging.key === "all" ? list : list.querySelector<HTMLElement>(`details.group-box[open]`);
      anchor?.scrollIntoView({ behavior: "smooth", block: "start" });
      return;
    }
    const editButton = target.closest<HTMLElement>("[data-edit]");
    if (editButton) {
      const product = ctx.repos.products.byId(editButton.dataset.edit!);
      if (product) form.startEdit(product);
      return;
    }
    const qrButton = target.closest<HTMLElement>("[data-qr]");
    if (qrButton) {
      const product = ctx.repos.products.byId(qrButton.dataset.qr!);
      if (product) void openProductQr(ctx, product);
      return;
    }
    const hideButton = target.closest<HTMLElement>("[data-hide]");
    if (hideButton) {
      const product = ctx.repos.products.byId(hideButton.dataset.hide!);
      if (!product) return;
      ctx.repos.products.upsert({ ...product, active: product.active === false, updated_at: nowISO() });
      return;
    }
    const deleteButton = target.closest<HTMLElement>("[data-delete]");
    if (deleteButton) {
      const product = ctx.repos.products.byId(deleteButton.dataset.delete!);
      if (!product) return;
      const confirmed = await confirmDialog({
        title: "Eliminar producto",
        message: `Se eliminará "${product.name}" de todas las sucursales. Las ventas pasadas no se afectan.`,
        confirmLabel: "Eliminar",
        danger: true
      });
      if (!confirmed) return;
      ctx.repos.products.softDelete(product.id);
      ctx.repos.stocks.all().filter((row) => row.product_id === product.id).forEach((row) => ctx.repos.stocks.softDelete(row.id));
      ctx.sales.purgeProduct(product.id);
      if (form.editingId() === product.id) form.resetForm();
      ctx.toast("Producto eliminado");
    }
  });

  listSearch.addEventListener("input", () => {
    pages.set("all", 0);
    if (searchTimer) clearTimeout(searchTimer);
    searchTimer = setTimeout(render, 180);
  });

  return {
    render,
    onFiltersChanged: () => {
      pages.set("all", 0);
      render();
    }
  };
}
