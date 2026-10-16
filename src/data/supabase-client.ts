import type { PosConfig } from "../core/config";
import type { AuthUser } from "../core/types";

export interface RawTokenResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  user: AuthUser;
  error?: { message: string };
  msg?: string;
}

/** Cliente REST mínimo de Supabase (sin SDK). */
export class SupabaseClient {
  constructor(readonly config: PosConfig) {}

  get configured(): boolean {
    return Boolean(this.config.supabaseUrl && this.config.supabaseKey);
  }

  private get base(): string {
    return this.config.supabaseUrl.replace(/\/$/, "");
  }

  private get apiKey(): string {
    return this.config.supabaseKey;
  }

  async login(email: string, password: string): Promise<RawTokenResponse> {
    const res = await fetch(`${this.base}/auth/v1/token?grant_type=password`, {
      method: "POST",
      headers: { apikey: this.apiKey, "Content-Type": "application/json" },
      body: JSON.stringify({ email, password })
    });
    return this.parseToken(res, "Usuario o contraseña incorrectos");
  }

  async refresh(refreshToken: string): Promise<RawTokenResponse> {
    const res = await fetch(`${this.base}/auth/v1/token?grant_type=refresh_token`, {
      method: "POST",
      headers: { apikey: this.apiKey, "Content-Type": "application/json" },
      body: JSON.stringify({ refresh_token: refreshToken })
    });
    if (!res.ok) {
      // Se adjunta el estado HTTP para que el llamador distinga credenciales
      // vencidas (la sesión ya no sirve) de un fallo de red o del servidor.
      const error = new Error("Sesión expirada") as Error & { status?: number };
      error.status = res.status;
      throw error;
    }
    return (await res.json()) as RawTokenResponse;
  }

  async logout(accessToken: string): Promise<void> {
    await fetch(`${this.base}/auth/v1/logout`, {
      method: "POST",
      headers: { apikey: this.apiKey, Authorization: `Bearer ${accessToken}` }
    }).catch(() => undefined);
  }

  async rpc(fn: string, accessToken: string): Promise<unknown> {
    const res = await fetch(`${this.base}/rest/v1/rpc/${fn}`, {
      method: "POST",
      headers: { apikey: this.apiKey, Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({})
    });
    if (!res.ok) throw new Error(`Error llamando a ${fn}`);
    return res.json();
  }

  /** Petición REST genérica (tablas). `path` ya incluye query string. */
  async rest(path: string, accessToken: string, init: RequestInit = {}): Promise<Response> {
    const headers: Record<string, string> = {
      apikey: this.apiKey,
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      "Cache-Control": "no-cache, no-store, max-age=0",
      Pragma: "no-cache",
      ...((init.headers as Record<string, string>) ?? {})
    };
    return fetch(`${this.base}/rest/v1/${path}`, { ...init, headers });
  }

  private async parseToken(res: Response, fallbackError: string): Promise<RawTokenResponse> {
    const body = (await res.json().catch(() => ({}))) as RawTokenResponse;
    if (!res.ok) {
      throw new Error(body.error?.message || body.msg || fallbackError);
    }
    return body;
  }
}
