import { HermesHttpError, makeHttp, type Http } from './http';

export interface HermesStatus {
  authRequired: boolean;
  authProviders: string[];
  gatewayState?: string;
}

export interface HermesUser {
  userId: string;
  email?: string;
  displayName: string;
  orgId?: string;
  provider: string;
  expiresAt: number;
}

export type AuthState =
  | { kind: 'checking' }
  | { kind: 'authenticated'; status: HermesStatus; user?: HermesUser }
  | { kind: 'unauthenticated'; status: HermesStatus; reason: string }
  | { kind: 'offline'; reason: string };

interface RawStatus {
  auth_required?: boolean;
  auth_providers?: string[];
  gateway_state?: string;
}

interface RawUser {
  user_id?: string;
  email?: string;
  display_name?: string;
  org_id?: string;
  provider?: string;
  expires_at?: number;
}

function toStatus(raw: RawStatus): HermesStatus {
  const status: HermesStatus = {
    authRequired: raw.auth_required === true,
    authProviders: Array.isArray(raw.auth_providers) ? raw.auth_providers : [],
  };
  if (raw.gateway_state !== undefined) status.gatewayState = raw.gateway_state;
  return status;
}

function toUser(raw: RawUser): HermesUser {
  const user: HermesUser = {
    userId: raw.user_id ?? 'unknown',
    displayName: raw.display_name ?? raw.email ?? 'Hermes user',
    provider: raw.provider ?? 'unknown',
    expiresAt: typeof raw.expires_at === 'number' ? raw.expires_at : 0,
  };
  if (raw.email !== undefined) user.email = raw.email;
  if (raw.org_id !== undefined) user.orgId = raw.org_id;
  return user;
}

export function makeAuthClient(http: Http = makeHttp()) {
  return {
    async status(): Promise<HermesStatus> {
      return toStatus(await http<RawStatus>('/api/status'));
    },

    async me(): Promise<HermesUser> {
      return toUser(await http<RawUser>('/api/auth/me'));
    },

    async check(): Promise<AuthState> {
      try {
        const status = await this.status();
        if (!status.authRequired) {
          return { kind: 'authenticated', status };
        }

        try {
          const user = await this.me();
          return { kind: 'authenticated', status, user };
        } catch (error) {
          if (error instanceof HermesHttpError && error.status === 401) {
            return { kind: 'unauthenticated', status, reason: 'Dashboard login is required.' };
          }
          throw error;
        }
      } catch (error) {
        return {
          kind: 'offline',
          reason: error instanceof Error ? error.message : 'Hermes API is unreachable.',
        };
      }
    },
  };
}
