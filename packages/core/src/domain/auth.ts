/**
 * Auth domain types — validated at the transport boundary.
 */

export interface HermesUser {
  userId: string;
  email?: string;
  displayName: string;
  orgId?: string;
  provider: string;
  expiresAt: number;
}

export interface AuthProvider {
  name: string;
  displayName: string;
  supportsPassword: boolean;
}

export interface LoginBody {
  provider: string;
  username: string;
  password: string;
  next?: string;
}

export interface LoginResult {
  ok: boolean;
  next: string;
}

export interface WsTicket {
  ticket: string;
  ttlSeconds: number;
}
