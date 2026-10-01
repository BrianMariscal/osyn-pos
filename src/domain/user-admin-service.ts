import type { Role } from "../core/types";
import type { AuthService } from "./auth-service";

export interface ManagedUser {
  user_id: string;
  email: string;
  name: string;
  role: Role;
  branch_id: string | null;
  created_at?: string;
}

export interface NewUserInput {
  email: string;
  password: string;
  name: string;
  role: Role;
  branch_id: string | null;
}

export interface UserPatch {
  user_id: string;
  name?: string;
  role?: Role;
  branch_id?: string | null;
  password?: string;
}

/** CRUD de usuarios vía /api/users (solo el dueño; la service key vive en el servidor). */
export class UserAdminService {
  constructor(private auth: AuthService) {}

  list(): Promise<ManagedUser[]> {
    return this.call("GET").then((data) => (data as { users: ManagedUser[] }).users ?? []);
  }

  create(input: NewUserInput): Promise<void> {
    return this.call("POST", input).then(() => undefined);
  }

  update(patch: UserPatch): Promise<void> {
    return this.call("PATCH", patch).then(() => undefined);
  }

  remove(userId: string): Promise<void> {
    return this.call("DELETE", { user_id: userId }).then(() => undefined);
  }

  private async call(method: "GET" | "POST" | "PATCH" | "DELETE", body?: unknown): Promise<unknown> {
    const token = this.auth.session?.access_token;
    if (!token) throw new Error("Sin sesión");
    const res = await fetch("/api/users", {
      method,
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: body === undefined ? undefined : JSON.stringify(body)
    });
    const data = (await res.json().catch(() => ({}))) as { error?: string };
    if (!res.ok) throw new Error(data.error || "No se pudo gestionar el usuario");
    return data;
  }
}
