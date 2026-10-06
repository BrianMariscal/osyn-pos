export interface PosConfig {
  supabaseUrl: string;
  supabaseKey: string;
  /** DSN de Sentry (plan gratuito). Vacío = sin monitoreo de errores. */
  sentryDsn: string;
}

/** Lee la config pública: public/config.js (window.POS_CONFIG) + enlace de setup por hash. */
export function readConfig(): PosConfig {
  const fromWindow = (window as unknown as { POS_CONFIG?: Partial<PosConfig> }).POS_CONFIG ?? {};
  const params = new URLSearchParams(location.hash.replace(/^#/, ""));
  const hashUrl = params.get("supabaseUrl") ?? "";
  const hashKey = params.get("supabaseKey") ?? "";
  return {
    supabaseUrl: hashUrl || fromWindow.supabaseUrl || "",
    supabaseKey: hashKey || fromWindow.supabaseKey || "",
    sentryDsn: fromWindow.sentryDsn || ""
  };
}

export function hasSetupHash(): boolean {
  const params = new URLSearchParams(location.hash.replace(/^#/, ""));
  return Boolean(params.get("supabaseUrl") && params.get("supabaseKey"));
}

export function clearSetupHash(): void {
  history.replaceState(null, "", location.origin + location.pathname + location.search);
}
