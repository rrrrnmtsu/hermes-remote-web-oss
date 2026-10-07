/**
 * Status / system domain types.
 */

export interface GatewayStatus {
  version?: string;
  releaseDate?: string;
  gatewayRunning?: boolean;
  gatewayState?: string;
  authRequired: boolean;
  authProviders: string[];
  activeSessions?: number;
}
