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

  /** Llama a cb con el valor inicial y después en cada cambio relevante. */
  watch<S>(selector: (state: T) => S, cb: (value: S) => void): Unsubscribe {
    let current = selector(this.state);
    cb(current);
    return this.subscribe(() => {
      const next = selector(this.state);
      if (!Object.is(next, current)) {
        current = next;
        cb(next);
      }
    });
  }

  private emit(): void {
    this.listeners.forEach((listener) => listener());
  }
}
