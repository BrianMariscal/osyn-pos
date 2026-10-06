import { nowISO } from "../core/dates";
import type { AuthSession, Role } from "../core/types";
import { loadAuthSession, saveAuthSession } from "../data/persist";
import type { SupabaseClient } from "../data/supabase-client";

export interface UserProfile {
  user_id: string;
  name: string;
  role: string;
  branch_id: string | null;
}

export class AuthService {
  session: AuthSession | null;
  private listeners = new Set<() => void>();

  constructor(private client: SupabaseClient) {
    this.session = loadAuthSession();
  }

  onSessionChange(cb: () => void): () => void {
    this.listeners.add(cb);
    return () => {
      this.listeners.delete(cb);
    };
  }

  get isAuthenticated(): boolean {
    return Boolean(this.session?.access_token);
  }

  /** Gerencia (dueño o administrador): opera toda la tienda, sin ver la app de vendedor. */
  isAdmin(): boolean {
    return this.session?.role === "dueno" || this.session?.role === "admin";
  }

  /** Dueño: única persona que gestiona usuarios y sucursales. */
  isOwner(): boolean {
    return this.session?.role === "dueno";
  }

  /** Nombre legible para mostrar (primera palabra). Cae al correo si el perfil trae basura tipo "[object Object]". */
  displayName(): string {
    const name = this.session?.name;
    if (typeof name === "string") {
      const clean = name.trim();
      if (clean && !/^\[object|^null$|^undefined$/i.test(clean)) return clean.split(" ")[0] ?? "";
    }
    const email = this.session?.user?.email ?? "";
    return email ? email.split("@")[0] ?? "" : "";
  }

  role(): Role {
    const role = this.session?.role;
    return role === "dueno" || role === "admin" ? role : "empleado";
  }

  /**
   * Sucursal fija del usuario: la del vendedor, o la del administrador si el
   * dueño le asignó una. null = puede ver y operar todas (dueño o admin general).
   */
  assignedBranchId(): string | null {
    const role = this.session?.role;
    if (role === "empleado" || role === "admin") return this.session?.branch_id ?? null;
    return null;
  }

  async login(email: string, password: string): Promise<void> {
    const raw = await this.client.login(email, password);
    this.setSession({
      access_token: raw.access_token,
      refresh_token: raw.refresh_token,
      expires_at: Math.floor(Date.now() / 1000) + Number(raw.expires_in || 3600),
      user: raw.user,
      role: "empleado",
      name: raw.user?.email ?? "",
      branch_id: null
    });
    await this.loadProfile();
  }

  async refreshIfNeeded(): Promise<void> {
    const session = this.session;
    if (!session?.refresh_token || !this.client.configured) return;
    if (session.expires_at && session.expires_at - 60 > Math.floor(Date.now() / 1000)) return;
    try {
      const raw = await this.client.refresh(session.refresh_token);
      this.setSession({
        ...session,
        access_token: raw.access_token,
        refresh_token: raw.refresh_token || session.refresh_token,
        expires_at: Math.floor(Date.now() / 1000) + Number(raw.expires_in || 3600),
        user: raw.user ?? session.user
      });
    } catch {
      this.setSession(null);
    }
  }

  async loadProfile(): Promise<void> {
    const session = this.session;
    if (!session) throw new Error("Sin sesión");
    const res = await this.client.rest(
      `profiles?user_id=eq.${encodeURIComponent(session.user.id)}&select=role,name,branch_id`,
      session.access_token
    );
    if (!res.ok) throw new Error("No se pudo cargar el perfil del usuario");
    const rows = (await res.json()) as Array<{ role: string; name: string | null; branch_id: string | null }>;
    const profile = rows[0];
    if (!profile) throw new Error("Este usuario no tiene perfil asignado");
    const profileName = typeof profile.name === "string" ? profile.name.trim() : "";
    const usableName = profileName && !/^\[object|^null$|^undefined$/i.test(profileName) ? profileName : "";
    const profileRole = profile.role === "dueno" || profile.role === "admin" || profile.role === "empleado" ? profile.role : "empleado";
    this.setSession({
      ...session,
      role: profileRole,
      name: usableName || session.user.email || "Usuario",
      branch_id: profile.branch_id ?? null
    });
  }

  async logout(): Promise<void> {
    const session = this.session;
    if (session && this.client.configured) {
      void this.client.logout(session.access_token);
    }
    this.setSession(null);
  }

  /** Admin: lista perfiles para asignar sucursales. */
  async listProfiles(): Promise<UserProfile[]> {
    const session = this.session;
    if (!session) throw new Error("Sin sesión");
    const res = await this.client.rest("profiles?select=user_id,name,role,branch_id&order=name.asc", session.access_token);
    if (!res.ok) throw new Error("No se pudieron leer los perfiles");
    return (await res.json()) as UserProfile[];
  }

  /** Admin: cambia la sucursal de un empleado. */
  async updateProfileBranch(userId: string, branchId: string): Promise<void> {
    const session = this.session;
    if (!session) throw new Error("Sin sesión");
    const res = await this.client.rest(`profiles?user_id=eq.${encodeURIComponent(userId)}`, session.access_token, {
      method: "PATCH",
      body: JSON.stringify({ branch_id: branchId, updated_at: nowISO() })
    });
    if (!res.ok) throw new Error("No se pudo asignar la sucursal");
  }

  private setSession(session: AuthSession | null): void {
    this.session = session;
    saveAuthSession(session);
    this.listeners.forEach((cb) => cb());
  }
}
