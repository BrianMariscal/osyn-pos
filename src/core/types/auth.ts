import type { Role } from "./base";

export interface AuthUser {
  id: string;
  email?: string;
}

export interface AuthSession {
  access_token: string;
  refresh_token: string;
  expires_at: number;
  user: AuthUser;
  role: Role;
  name: string;
  branch_id: string | null;
}
