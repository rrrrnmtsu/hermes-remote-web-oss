/** DOM-free notification subscription coordinator; it never submits a prompt or approval. */
export type PushPermission = 'default' | 'granted' | 'denied' | 'unsupported';
export interface BrowserPushSubscription {
  endpoint: string;
  expirationTime: number | null;
  keys: { p256dh: string; auth: string };
}
export interface BrowserPushPort {
  supported: boolean;
  permission(): PushPermission;
  requestPermission(): Promise<PushPermission>;
  subscription(): Promise<BrowserPushSubscription | null>;
  subscribe(publicKey: string): Promise<BrowserPushSubscription>;
  unsubscribe(): Promise<boolean>;
  fingerprint(endpoint: string): Promise<string>;
}
export interface NotificationScope { profile: string; durableSession: string; generation: string; connected: boolean }
export interface NotificationAccess {
  scope(): NotificationScope;
  supports(method: string): boolean;
  request<T>(method: string, params: Record<string, unknown>, write?: boolean): Promise<T>;
}
export interface NotificationSubscription {
  id: string; session_id: string; endpoint_fingerprint: string; expires_at: number;
  last_status: 'registered' | 'sent' | 'failed' | 'unavailable' | 'delivery_unknown';
}
export interface NotificationStatus {
  available: boolean; reason: string; public_key: string | null;
  subscriptions: NotificationSubscription[]; scope: 'authenticated_owner_profile_session';
  ttl_seconds: number; max_subscriptions: number;
}
export interface NotificationSnapshot {
  phase: 'idle' | 'loading' | 'ready' | 'working' | 'enabled' | 'unsupported' | 'unknown' | 'error';
  permission: PushPermission; diagnostic: string; expiresAt: number | null;
}

export class NotificationController {
  private state: NotificationSnapshot = { phase: 'idle', permission: 'default', diagnostic: '', expiresAt: null };
  private listeners = new Set<() => void>();
  private status: NotificationStatus | null = null;
  private registered: NotificationSubscription | null = null;
  private generation = 0; private busy = false;
  constructor(private readonly access: NotificationAccess, private readonly browser: BrowserPushPort) {}
  snapshot = (): NotificationSnapshot => this.state;
  subscribe = (listener: () => void): (() => void) => { this.listeners.add(listener); return () => this.listeners.delete(listener); };
  async refresh(): Promise<void> {
    if (this.busy) return;
    const scope = this.access.scope(); const generation = ++this.generation;
    this.registered = null; this.status = null;
    if (!this.browser.supported || !this.access.supports('remote.notifications.status')) {
      this.patch({ phase: 'unsupported', permission: this.browser.permission(), diagnostic: 'このブラウザ・接続先はWeb Pushに未対応です。', expiresAt: null }); return;
    }
    if (!scope.connected || !scope.durableSession) {
      this.patch({ phase: 'idle', permission: this.browser.permission(), diagnostic: '接続済みの保存会話を選択してください。', expiresAt: null }); return;
    }
    this.patch({ phase: 'loading', permission: this.browser.permission(), diagnostic: '', expiresAt: null });
    try {
      const status = await this.access.request<NotificationStatus>('remote.notifications.status', { profile: scope.profile, session_id: scope.durableSession });
      if (!this.current(scope, generation)) return;
      if (!validStatus(status)) throw new Error('unsupported');
      const subscription = await this.browser.subscription();
      const fingerprint = subscription ? await this.browser.fingerprint(subscription.endpoint) : '';
      if (!this.current(scope, generation)) return;
      this.status = status;
      this.registered = status.subscriptions.find(item => item.endpoint_fingerprint === fingerprint && item.session_id === scope.durableSession) || null;
      this.patch({ phase: !status.available ? 'unsupported' : this.registered ? 'enabled' : 'ready', permission: this.browser.permission(),
        diagnostic: !status.available ? '接続先のアプリ用通知設定を確認できません。通知は送信されません。' : this.registered?.last_status === 'delivery_unknown' ? '直近の通知配送結果は不明です。会話の実状態を確認してください。' : '',
        expiresAt: this.registered?.expires_at ?? null });
    } catch { if (this.current(scope, generation)) this.patch({ phase: 'error', diagnostic: '通知の登録状態を取得できません。自動登録・再送は行いません。' }); }
  }
  async enable(): Promise<boolean> {
    if (this.busy || this.state.phase !== 'ready' || !this.status?.available || !this.status.public_key) return false;
    const scope = { ...this.access.scope() }; const generation = this.generation;
    if (!scope.connected || !scope.durableSession || !this.access.supports('remote.notifications.subscribe')) return false;
    this.busy = true; this.patch({ phase: 'working', diagnostic: '' }); let started = false;
    try {
      const permission = await this.browser.requestPermission();
      if (!this.current(scope, generation)) return false;
      this.patch({ permission });
      if (permission !== 'granted') { this.patch({ phase: 'ready', diagnostic: '通知は許可されていません。自動で再要求しません。' }); return false; }
      const subscription = await this.browser.subscribe(this.status.public_key);
      if (!this.current(scope, generation)) return false;
      const fingerprint = await this.browser.fingerprint(subscription.endpoint);
      if (!this.current(scope, generation)) return false;
      started = true;
      const response = await this.access.request<{ subscription: NotificationSubscription }>('remote.notifications.subscribe', { profile: scope.profile, session_id: scope.durableSession, subscription }, true);
      if (!this.current(scope, generation)) return false;
      if (!validEntry(response.subscription) || response.subscription.session_id !== scope.durableSession || response.subscription.endpoint_fingerprint !== fingerprint) throw new Error('unknown');
      this.registered = response.subscription;
      this.patch({ phase: 'enabled', diagnostic: 'この会話の通知を登録しました。通知から開いた後に認証と実状態を再確認します。', expiresAt: response.subscription.expires_at }); return true;
    } catch {
      if (this.current(scope, generation)) this.patch({ phase: started ? 'unknown' : 'error', diagnostic: started ? '通知登録の結果は不明です。状態を再取得してから操作してください。自動再登録しません。' : '端末の通知購読を開始できません。自動再試行しません。' });
      return false;
    } finally { this.busy = false; }
  }
  async disable(): Promise<boolean> {
    if (this.busy || this.state.phase !== 'enabled' || !this.registered || !this.access.supports('remote.notifications.unsubscribe')) return false;
    const scope = { ...this.access.scope() }; const generation = this.generation; const id = this.registered.id;
    this.busy = true; this.patch({ phase: 'working', diagnostic: '' });
    try {
      const response = await this.access.request<{ removed: number }>('remote.notifications.unsubscribe', { profile: scope.profile, subscription_id: id }, true);
      if (!this.current(scope, generation)) return false;
      if (!Number.isInteger(response.removed) || response.removed < 0 || response.removed > 1) throw new Error('unknown');
      this.registered = null; this.patch({ phase: 'ready', expiresAt: null, diagnostic: 'この会話のサーバー購読を解除しました。他の会話の通知設定は維持します。' }); return true;
    } catch {
      if (this.current(scope, generation)) this.patch({ phase: 'unknown', diagnostic: '通知解除の結果は不明です。登録状態を再取得してください。自動再解除しません。' }); return false;
    } finally { this.busy = false; }
  }
  async logout(): Promise<{ browser: 'revoked' | 'unknown'; server: 'revoked' | 'unknown' | 'not_connected' }> {
    const scope = { ...this.access.scope() };
    this.reset();
    let browser: 'revoked' | 'unknown' = 'unknown';
    let server: 'revoked' | 'unknown' | 'not_connected' = 'not_connected';
    try { browser = await this.browser.unsubscribe() ? 'revoked' : 'unknown'; } catch { /* Keep uncertainty visible to the logout caller. */ }
    if (scope.connected && this.access.supports('remote.notifications.unsubscribe_all')) {
      server = 'unknown';
      try { const result = await this.access.request<{ removed: number }>('remote.notifications.unsubscribe_all', { profile: scope.profile }, true); if (Number.isInteger(result.removed) && result.removed >= 0) server = 'revoked'; } catch { /* Auth logout proceeds; old subscriptions expire or return 410. */ }
    }
    return { browser, server };
  }
  reset(): void { this.generation += 1; this.status = null; this.registered = null; this.patch({ phase: 'idle', permission: this.browser.permission(), diagnostic: '', expiresAt: null }); }
  private current(scope: NotificationScope, generation: number): boolean {
    const current = this.access.scope();
    return generation === this.generation && current.profile === scope.profile && current.durableSession === scope.durableSession && current.generation === scope.generation && current.connected;
  }
  private patch(values: Partial<NotificationSnapshot>): void { this.state = { ...this.state, ...values }; for (const listener of this.listeners) listener(); }
}
function validEntry(entry: NotificationSubscription): boolean {
  return !!entry && typeof entry.id === 'string' && /^[a-f0-9]{32}$/.test(entry.id) && typeof entry.session_id === 'string' && /^[a-f0-9]{64}$/.test(entry.endpoint_fingerprint) && Number.isFinite(entry.expires_at);
}
function validStatus(status: NotificationStatus): boolean {
  return !!status && status.scope === 'authenticated_owner_profile_session' && Array.isArray(status.subscriptions) && status.subscriptions.length <= 8 && status.subscriptions.every(validEntry) && (!status.available || typeof status.public_key === 'string' && status.public_key.length <= 128);
}
