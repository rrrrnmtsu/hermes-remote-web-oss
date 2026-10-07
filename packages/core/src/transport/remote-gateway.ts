import { JsonRpcGatewayClient } from '../vendor/hermes/json-rpc-gateway';
import type { ServerRequest, GatewayRequestId } from '../vendor/hermes/json-rpc-channel';
import type { GatewayEvent } from '../vendor/hermes/gateway-events';

export type { ServerRequest, GatewayRequestId, GatewayEvent };

export interface RemoteGateway {
  setTicket(ticket: string): void;
  connect(url: string): Promise<void>;
  close(): void;
  request<T>(method: string, params?: Record<string, unknown>, timeoutMs?: number): Promise<T>;
  onAny(handler: (event: GatewayEvent) => void): () => void;
  onRequest(handler: (request: ServerRequest) => boolean | void): () => void;
  onState(handler: (state: string) => void): () => void;
  awaitSessionReplay(sessionId: string): Promise<boolean>;
  getSeqWatermarks(): Record<string, number>;
}

/** The official reconnect replay also needs the owning profile on session RPCs. */
export class ProfileGateway extends JsonRpcGatewayClient implements RemoteGateway {
  private readonly updateTicket: (ticket: string) => void;
  constructor(
    private readonly profile: string,
    socketFactory: (url: string, ticket: string) => WebSocket,
  ) {
    let currentTicket = '';
    super({ socketFactory: url => {
      const ticket = currentTicket;
      currentTicket = '';
      return socketFactory(url, ticket);
    }, connectTimeoutMs: 15_000, requestTimeoutMs: 15_000 });
    this.updateTicket = ticket => { currentTicket = ticket; };
  }

  setTicket(ticket: string): void { this.updateTicket(ticket); }

  async awaitSessionReplay(sessionId: string): Promise<boolean> {
    return (await this.sessionReplayBarrier(sessionId)) ?? true;
  }

  override request<T>(
    method: string,
    params: Record<string, unknown> = {},
    timeoutMs?: number,
    signal?: AbortSignal,
  ): Promise<T> {
    const scoped = typeof params.session_id === 'string'
      ? { ...params, profile: this.profile }
      : params;
    return super.request<T>(method, scoped, timeoutMs, signal);
  }
}

export function requestKey(id: GatewayRequestId): string {
  return `${typeof id}:${id}`;
}
