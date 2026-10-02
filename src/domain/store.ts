export type Unsubscribe = () => void;

/**
 * Store reactivo mínimo: los servicios mutan vía update(), los componentes se
 * suscriben con watch(selector, cb) y solo re-renderizan cuando SU valor cambia
 * (comparación por referencia). Regla: los mutadores REEMPLAZAN arreglos/objetos
 * (s.products = [...]) en lugar de mutarlos en el sitio.
 */
export class Store<T extends object> {
  private state: T;
  private listeners = new Set<() => void>();

  constructor(initial: T) {
    this.state = initial;
  }

  getState(): T {
    return this.state;
  }

  /** Reemplaza el estado completo (usado al cargar snapshot del dispositivo). */
  setState(next: T): void {
    this.state = next;
    this.emit();
  }

  update(mutator: (state: T) => void): void {
    const next = { ...this.state };
    mutator(next);
    this.state = next;
    this.emit();
  }

  subscribe(listener: () => void): Unsubscribe {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /**
   * Llama a cb con el valor inicial y después en cada cambio relevante.
   * Los selectores de tupla (`[s.products, s.sales] as const`) se comparan
   * elemento por elemento: antes se comparaba el arreglo nuevo por referencia,
   * así que CUALQUIER cambio (estado de sync, carrito) redibujaba todas las
   * pestañas y borraba lo que el usuario estaba capturando.
   */
  watch<S>(selector: (state: T) => S, cb: (value: S) => void): Unsubscribe {
    let current = selector(this.state);
    cb(current);
    return this.subscribe(() => {
      const next = selector(this.state);
      if (!sameSelection(next, current)) {
        current = next;
        cb(next);
      }
    });
  }

  private emit(): void {
    this.listeners.forEach((listener) => listener());
  }
}

/** Igualdad de selección: misma referencia, o tuplas con los mismos elementos. */
export function sameSelection(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
  return a.every((value, index) => Object.is(value, b[index]));
}
