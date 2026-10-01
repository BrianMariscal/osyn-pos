import type { TabId } from "../../core/types";
import type { AppContext } from "../context";

export interface TabModule {
  id: TabId;
  /** Se llama una vez al arrancar; el módulo deja sus suscripciones montadas. */
  render(root: HTMLElement, ctx: AppContext): void;
}
