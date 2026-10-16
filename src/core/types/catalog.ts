import type { SaleGroup, Unit } from "./base";

export interface Branch {
  id: string;
  name: string;
  address: string;
  active: boolean;
  created_at?: string;
  updated_at: string;
  deleted?: boolean;
}

export interface Product {
  id: string;
  name: string;
  category: string;
  um: Unit;
  cost: number;
  price: number;
  barcode?: string;
  /** Proveedor que surte el producto (catálogo de proveedores). */
  supplier_id?: string;
  /** Piezas por caja/paquete: las compras capturadas en cajas se convierten a piezas. */
  pack_size?: number;
  /** Precio de venta de la caja completa (cigarros: cajetilla). Sin valor = no se vende por caja. */
  pack_price?: number;
  /** Grupo para el corte (cigarros/cerveza). Sin valor = se detecta por categoría/nombre. */
  sale_group?: SaleGroup;
  /** Existencia heredada: se migra a product_stocks al primer arranque. */
  stock?: number;
  min_stock?: number;
  active: boolean;
  seed_example?: boolean;
  created_at?: string;
  updated_at: string;
  deleted?: boolean;
}

/** Existencia de un producto en una sucursal. id = `${product_id}:${branch_id}` */
export interface ProductStock {
  id: string;
  product_id: string;
  branch_id: string;
  stock: number;
  min_stock: number;
  updated_at: string;
  deleted?: boolean;
}

/** Catálogo global de proveedores (Central de Abastos, distribuidoras, etc.). */
export interface Supplier {
  id: string;
  /** Número de proveedor consecutivo, asignado automáticamente. */
  number?: number;
  name: string;
  /** Giro: qué tipo de productos surte (refrescos, cerveza, cigarros…). */
  type?: string;
  phone: string;
  notes: string;
  created_at?: string;
  updated_at: string;
  deleted?: boolean;
}
