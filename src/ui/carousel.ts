/**
 * Recuadros con movimiento para Venta (más vendidos, por agotarse, ofertas).
 * Cada fila se desliza sola de ida y vuelta; se detiene mientras el usuario la
 * toca o pasa el mouse, y no se mueve con "reducir movimiento" activado.
 */
import { html, setHtml } from "../core/html";

export interface CarouselItem {
  productId: string;
  name: string;
  price: string;
  /** Precio normal tachado (ofertas). */
  was?: string;
  promoPrice?: number;
  badge: string;
  detail: string;
  disabled: boolean;
}

export interface CarouselSection {
  id: string;
  title: string;
  subtitle: string;
  empty: string;
  items: CarouselItem[];
}

interface TrackState {
  pos: number;
  dir: 1 | -1;
  pausedUntil: number;
}

const SPEED_PX_PER_FRAME = 0.35;
const RESUME_AFTER_MS = 2500;

export function mountCarousels(container: HTMLElement, isVisible: () => boolean): { render(sections: CarouselSection[]): void } {
  const states = new WeakMap<HTMLElement, TrackState>();
  const reduceMotion = typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  let frame = 0;

  const pause = (track: HTMLElement, ms = Number.POSITIVE_INFINITY): void => {
    const state = states.get(track);
    if (state) state.pausedUntil = Date.now() + ms;
  };
  const resumeLater = (track: HTMLElement): void => {
    const state = states.get(track);
    if (!state) return;
    state.pos = track.scrollLeft;
    state.pausedUntil = Date.now() + RESUME_AFTER_MS;
  };

  const tick = (): void => {
    frame = requestAnimationFrame(tick);
    if (document.hidden || !isVisible()) return;
    const now = Date.now();
    container.querySelectorAll<HTMLElement>("[data-track]").forEach((track) => {
      const state = states.get(track);
      const max = track.scrollWidth - track.clientWidth;
      if (!state || max <= 2 || now < state.pausedUntil) return;
      state.pos += SPEED_PX_PER_FRAME * state.dir;
      if (state.pos >= max) {
        state.pos = max;
        state.dir = -1;
        state.pausedUntil = now + 1200;
      } else if (state.pos <= 0) {
        state.pos = 0;
        state.dir = 1;
        state.pausedUntil = now + 1200;
      }
      track.scrollLeft = state.pos;
    });
  };

  const wire = (track: HTMLElement): void => {
    states.set(track, { pos: 0, dir: 1, pausedUntil: Date.now() + 1500 });
    track.addEventListener("pointerenter", () => pause(track));
    track.addEventListener("pointerleave", () => resumeLater(track));
    track.addEventListener("touchstart", () => pause(track), { passive: true });
    track.addEventListener("touchend", () => resumeLater(track), { passive: true });
    track.addEventListener("focusin", () => pause(track));
    track.addEventListener("focusout", () => resumeLater(track));
    // Rueda o arrastre manual: se respeta la posición elegida.
    track.addEventListener("wheel", () => resumeLater(track), { passive: true });
  };

  const tile = (section: CarouselSection, item: CarouselItem) => html`
    <button
      class="mini-tile mini-${section.id}"
      type="button"
      data-add="${item.productId}"
      ${item.promoPrice !== undefined ? html`data-promo="${item.promoPrice}"` : html``}
      ${item.disabled ? "disabled" : null}
    >
      <span class="mini-badge">${item.badge}</span>
      <strong>${item.name}</strong>
      <span class="mini-price">${item.was ? html`<s>${item.was}</s> ` : html``}<b>${item.price}</b></span>
      <span class="mini-detail">${item.detail}</span>
    </button>
  `;

  return {
    render(sections) {
      // Conserva la posición de cada fila al redibujar (ventas, sync).
      const previous = new Map<string, TrackState>();
      container.querySelectorAll<HTMLElement>("[data-track]").forEach((track) => {
        const state = states.get(track);
        if (state) previous.set(track.dataset.track!, { ...state, pos: track.scrollLeft });
      });
      setHtml(
        container,
        html`${sections.map(
          (section) => html`
            <section class="carousel carousel-${section.id}" aria-label="${section.title}">
              <div class="carousel-head">
                <h3>${section.title}</h3>
                <span class="hint">${section.subtitle}</span>
              </div>
              ${section.items.length
                ? html`<div class="carousel-track" data-track="${section.id}" tabindex="0">${section.items.map((item) => tile(section, item))}</div>`
                : html`<p class="muted carousel-empty">${section.empty}</p>`}
            </section>
          `
        )}
        <button class="ghost block" type="button" data-show-catalog>Ver catálogo completo</button>`
      );
      container.querySelectorAll<HTMLElement>("[data-track]").forEach((track) => {
        wire(track);
        const before = previous.get(track.dataset.track!);
        const state = states.get(track)!;
        if (before) {
          Object.assign(state, before);
          track.scrollLeft = before.pos;
        }
      });
      if (!reduceMotion && !frame) frame = requestAnimationFrame(tick);
    }
  };
}
