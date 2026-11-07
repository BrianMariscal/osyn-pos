const DEFAULT_FAVICON = "/icons/icon.svg";
let faviconSource: string | null = null;

/**
 * Ícono de la pestaña del navegador: el logo de la tienda o el ícono de la app.
 * El logo se reduce a 64×64 (centrado, sin deformar) para no cargar la imagen
 * completa como favicon.
 */
export function applyFavicon(logo: string): void {
  if (faviconSource === logo) return;
  faviconSource = logo;
  let link = document.querySelector<HTMLLinkElement>('link[rel="icon"]');
  if (!link) {
    link = document.createElement("link");
    link.rel = "icon";
    document.head.appendChild(link);
  }
  const target = link;
  if (!logo) {
    target.type = "image/svg+xml";
    target.href = DEFAULT_FAVICON;
    return;
  }
  const img = new Image();
  img.onload = () => {
    if (faviconSource !== logo) return;
    const size = 64;
    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;
    const context = canvas.getContext("2d");
    if (!context || !img.naturalWidth || !img.naturalHeight) return;
    const scale = Math.min(size / img.naturalWidth, size / img.naturalHeight);
    const width = img.naturalWidth * scale;
    const height = img.naturalHeight * scale;
    context.drawImage(img, (size - width) / 2, (size - height) / 2, width, height);
    target.type = "image/png";
    target.href = canvas.toDataURL("image/png");
  };
  img.src = logo;
}

const BRAND_KEY = "pos-brand";

export function rememberBrand(name: string, logo: string): void {
  try {
    localStorage.setItem(BRAND_KEY, JSON.stringify({ name, logo }));
  } catch {
    /* sin espacio o almacenamiento bloqueado: el login usa la letra */
  }
}

export function rememberedBrand(name: string, logo: string): { name: string; logo: string } {
  try {
    const saved = JSON.parse(localStorage.getItem(BRAND_KEY) ?? "null") as { name?: string; logo?: string } | null;
    return { name: name && name !== "Mi tienda" ? name : saved?.name || name, logo: logo || saved?.logo || "" };
  } catch {
    return { name, logo };
  }
}

/** Logo o, si no hay o la imagen falla, la inicial de la tienda. */
export function showLogo(imgId: string, markId: string, logo: string, name: string): void {
  const img = document.getElementById(imgId) as HTMLImageElement | null;
  const mark = document.getElementById(markId);
  if (mark) mark.textContent = name.trim().charAt(0).toUpperCase() || "O";
  const fallback = (): void => {
    img?.classList.add("hidden");
    mark?.classList.remove("hidden");
  };
  if (!img || !logo) {
    fallback();
    return;
  }
  img.onerror = fallback;
  img.onload = () => {
    img.classList.remove("hidden");
    mark?.classList.add("hidden");
  };
  img.alt = name;
  if (img.getAttribute("src") !== logo) img.src = logo;
  else if (img.complete && img.naturalWidth) img.onload(new Event("load"));
}
