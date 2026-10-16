/** Lectura tolerante de localStorage: si no está disponible, cadena vacía. */
export function readLocal(key: string): string {
  try {
    return localStorage.getItem(key) ?? "";
  } catch {
    return "";
  }
}
