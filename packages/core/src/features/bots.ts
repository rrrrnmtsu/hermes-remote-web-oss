import { createStore } from 'zustand/vanilla';

export interface BotScope { origin: string; principal: string; profile: string; generation: string; }
export type GatewayBotState = 'running' | 'starting' | 'draining' | 'degraded' | 'stopped' | 'startup_failed' | 'unknown';
export type BotConnectionState = 'connected' | 'disconnected' | 'disabled' | 'not_configured' | 'pending_restart' | 'gateway_stopped' | 'starting' | 'paused' | 'fatal' | 'unknown';
export interface BotPlatform { id: string; name: string; state: BotConnectionState; updatedAt: string | null; }
export interface BotSnapshot {
  profile: string; running: boolean; gatewayState: GatewayBotState; platforms: BotPlatform[];
  platformsAvailable: boolean; truncated: boolean; updatedAt: string | null; observedAt: number;
  heartbeatStaleSeconds: number | null; sharedGateway: boolean | null;
}
export interface BotPort { readStatus(profile: string, signal: AbortSignal): Promise<unknown>; }
export interface BotOverviewState {
  scope: BotScope | null; load: 'idle' | 'loading' | 'ready' | 'unsupported' | 'error';
  snapshot: BotSnapshot | null; error: string;
}

const gatewayStates = new Set<GatewayBotState>(['running', 'starting', 'draining', 'degraded', 'stopped', 'startup_failed', 'unknown']);
const platformStates = new Set<BotConnectionState>(['connected', 'disconnected', 'disabled', 'not_configured', 'pending_restart', 'gateway_stopped', 'starting', 'paused', 'fatal', 'unknown']);
const platformNames: Readonly<Record<string, string>> = {
  discord: 'Discord', telegram: 'Telegram', slack: 'Slack', signal: 'Signal', whatsapp: 'WhatsApp',
  whatsapp_cloud: 'WhatsApp Cloud', email: 'メール', line: 'LINE', matrix: 'Matrix', teams: 'Microsoft Teams',
  homeassistant: 'Home Assistant', mattermost: 'Mattermost', feishu: 'Feishu / Lark', wecom: 'WeCom',
  dingtalk: 'DingTalk', sms: 'SMS', bluebubbles: 'BlueBubbles', google_chat: 'Google Chat', ntfy: 'ntfy',
};
const initial = (): BotOverviewState => ({ scope: null, load: 'idle', snapshot: null, error: '' });
const scopeKey = (scope: BotScope | null): string => scope ? JSON.stringify([scope.origin, scope.principal, scope.profile, scope.generation]) : '';
function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
}
function timestamp(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > 40 || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value)) return null;
  const date = Date.parse(value);
  return Number.isFinite(date) ? new Date(date).toISOString() : null;
}

/** Whitelist the fixed Dashboard GET /api/status projection; never retain raw status, errors or credentials. */
export function projectBotStatus(value: unknown, profile: string, observedAt = Date.now()): BotSnapshot | null {
  const data = record(value);
  if (!data || !Object.hasOwn(data, 'gateway_running')) return null;
  if (typeof data.gateway_running !== 'boolean') throw new Error('bot_status_contract');
  const running = data.gateway_running;
  let gatewayState: GatewayBotState = gatewayStates.has(data.gateway_state as GatewayBotState) ? data.gateway_state as GatewayBotState : 'unknown';
  if (!running && ['running', 'starting', 'draining', 'degraded'].includes(gatewayState)) gatewayState = 'unknown';
  const raw = data.gateway_platforms === undefined || data.gateway_platforms === null ? null : record(data.gateway_platforms);
  if (data.gateway_platforms != null && !raw) throw new Error('bot_platform_contract');
  const keys = Object.keys(raw || {});
  const platforms: BotPlatform[] = [];
  let omitted = false;
  for (const key of keys.slice(0, 50)) {
    // A scoped request must never render another profile's namespaced row.
    const parts = key.split(':');
    if (parts.length > 2 || (parts.length === 2 && parts[0] !== profile)) { omitted = true; continue; }
    const id = parts.at(-1) || '';
    if (!/^[a-z][a-z0-9_-]{0,31}$/.test(id) || platforms.some(row => row.id === id)) { omitted = true; continue; }
    const item = record(raw?.[key]);
    if (!item) { omitted = true; continue; }
    let state: BotConnectionState = platformStates.has(item.state as BotConnectionState) ? item.state as BotConnectionState : 'unknown';
    if (state === 'unknown' && item.connected === true) state = 'connected';
    if (state === 'unknown' && item.connected === false) state = 'disconnected';
    if (state === 'connected' && item.connected === false) state = 'unknown';
    if (!running && state === 'connected') state = gatewayState === 'stopped' ? 'gateway_stopped' : 'unknown';
    platforms.push({ id, name: platformNames[id] || 'その他のボット', state, updatedAt: timestamp(item.updated_at) });
  }
  const age = data.gateway_heartbeat_stale_s;
  return { profile, running, gatewayState, platforms, platformsAvailable: raw !== null,
    truncated: keys.length > 50 || omitted, updatedAt: timestamp(data.gateway_updated_at), observedAt,
    heartbeatStaleSeconds: typeof age === 'number' && Number.isFinite(age) && age > 0 ? age : null,
    sharedGateway: Array.isArray(data.gateway_shared_with) ? data.gateway_shared_with.length > 1 : null };
}

/** One explicit read at a time; close/auth/profile/socket changes abort and invalidate late replies. */
export class BotOverviewController {
  readonly store = createStore<BotOverviewState>(() => initial());
  private revision = 0;
  private pending: AbortController | null = null;
  constructor(private readonly port: BotPort) {}
  setScope(scope: BotScope | null): void {
    if (scopeKey(scope) === scopeKey(this.store.getState().scope)) return;
    this.cancel(); this.store.setState({ ...initial(), scope });
  }
  cancel(): void {
    this.revision++; this.pending?.abort(); this.pending = null;
    this.store.setState({ load: 'idle', snapshot: null, error: '' });
  }
  async load(): Promise<void> {
    const scope = this.store.getState().scope;
    if (!scope || this.pending) return;
    const revision = ++this.revision, abort = new AbortController(); this.pending = abort;
    const current = (): boolean => revision === this.revision && scopeKey(scope) === scopeKey(this.store.getState().scope) && !abort.signal.aborted;
    this.store.setState({ load: 'loading', error: '' });
    try {
      const value = await this.port.readStatus(scope.profile, abort.signal);
      if (!current()) return;
      const snapshot = projectBotStatus(value, scope.profile);
      this.store.setState({ load: snapshot ? 'ready' : 'unsupported', snapshot });
    } catch {
      if (current()) this.store.setState({ load: 'error', error: 'ボットの状態を確認できませんでした。表示中の結果は以前の取得です。自動で再取得しません。' });
    } finally { if (this.pending === abort) this.pending = null; }
  }
}

export function botSessions<T extends { source: string }>(sessions: readonly T[], platforms: readonly BotPlatform[]): T[] {
  const ids = new Set(platforms.map(row => row.id));
  return sessions.filter(session => ids.has(session.source.toLowerCase())).slice(0, 50);
}
