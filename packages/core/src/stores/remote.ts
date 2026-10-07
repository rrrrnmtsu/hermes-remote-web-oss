import { createStore } from 'zustand/vanilla';
import type { ConversationPage } from '../features/conversations';
import { documentLimits, documentSnapshot, DOCUMENT_UNAVAILABLE, type DocumentSelection, type DocumentCapabilities, type DocumentTurnReceipt, type RemoteDocument } from '../features/documents';
import { HermesHttpError, type Http } from '../transport/http';
import { requestKey, type RemoteGateway, type GatewayEvent, type ServerRequest } from '../transport/remote-gateway';
import type { SessionActivateResult as LiveSessionSnapshot, SessionCreateResult, SessionListResult, SessionEventsSinceResult, PromptSubmitResult, ProjectsTreeResult, ProjectsProjectSessionsResult } from '../vendor/hermes/gateway-contract.generated';
import type { ImageTurnCapabilities } from '../vendor/hermes/gateway-contract.generated';
import { imageRawLimit, validateImageSelection, imageBase64, IMAGE_UNAVAILABLE, type ImageSelection, type RemoteImage, type ImageQueue } from './image-transfer';

export type ConnectionPhase = 'idle' | 'https' | 'auth' | 'ticket' | 'wss' | 'gateway' | 'rpc' | 'connected' | 'reconnecting' | 'offline' | 'reauth' | 'unsupported' | 'error' | 'logged_out';
export type DeliveryState = 'draft' | 'sending' | 'accepted' | 'delivery_unknown' | 'failed_before_send';
export type ExecutionState = 'idle' | 'running' | 'waiting_input' | 'stop_requested' | 'completed' | 'failed' | 'unknown' | 'stopped';
export type ConnectionFailure = '' | 'auth_401' | 'forbidden_403' | 'http' | 'network_or_tls' | 'timeout' | 'version_mismatch' | 'websocket' | 'rpc';
export interface RemoteMessage { id: string; role: string; text: string; }
export interface RemoteTool { id: string; name: string; detail: string; status: string; }
export interface RemoteSession { durableId: string; lineageId: string; title: string; source: string; lastActive?: number | null; messageCount?: number | null; }
export interface RemoteProject {
  id: string;
  label: string;
  kind: 'registered' | 'automatic' | 'unassigned';
  sessionCount: number;
  sessionIds: string[];
  previews: RemoteSession[];
  lastActive: number | null;
}
export interface RemoteRequest {
  key: string;
  id: string | number;
  method: string;
  profile: string;
  sessionId: string;
  params: Record<string, unknown>;
  status: 'pending' | 'checking' | 'response_unknown' | 'resolved' | 'cancelled' | 'unsupported';
}
export interface RemoteState {
  connection: ConnectionPhase;
  diagnostic: string;
  failureKind: ConnectionFailure;
  failedStage: ConnectionPhase;
  targetVersion: string;
  https: boolean;
  authenticated: boolean;
  wss: boolean;
  gatewayReady: boolean;
  readRpc: boolean;
  profiles: string[];
  profile: string;
  sessions: RemoteSession[];
  projects: RemoteProject[];
  projectsStatus: 'idle' | 'loading' | 'ready' | 'unsupported' | 'error';
  projectsError: string;
  selectedProjectId: string;
  projectSessions: RemoteSession[];
  projectLoading: boolean;
  projectError: string;
  liveId: string;
  durableId: string;
  lineageId: string;
  messages: RemoteMessage[];
  tools: RemoteTool[];
  requests: RemoteRequest[];
  draft: string;
  delivery: DeliveryState;
  execution: ExecutionState;
  stopUnknown: boolean;
  lastSync: number | null;
  epoch: string;
  syncWarning: string;
  listLoading: boolean;
  sessionLoading: boolean;
  submitInProgress: boolean;
  exclusiveSubmit: boolean;
  attachment: RemoteImage | null;
  imageQueue: ImageQueue;
  imageDiagnostic: string;
  imageSelecting: boolean;
  imageTurnVersion: boolean;
  imageCapabilities: ImageTurnCapabilities | null;
  document: RemoteDocument | null;
  documentCapabilities: DocumentCapabilities | null;
  documentDiagnostic: string;
  featureMethods: string[];
  principalId: string;
  featureBusy: boolean;
  generationAllowed: boolean;
  generationReason: string;
}

export interface RemoteOptions {
  http: Http;
  origin: string;
  secure: boolean;
  makeGateway(profile: string): RemoteGateway;
  /** Shell owns the browser Web Lock. No ownership takeover is attempted. */
  withOperationLock<T>(action: () => Promise<T>): Promise<T | undefined>;
  onLocalLogout?: () => void;
}

const initialState = (): RemoteState => ({
  connection: 'idle', diagnostic: '', failureKind: '', failedStage: 'idle', targetVersion: '', https: false,
  authenticated: false, wss: false, gatewayReady: false, readRpc: false,
  profiles: [], profile: 'default', sessions: [], liveId: '', durableId: '', lineageId: '',
  projects: [], projectsStatus: 'idle', projectsError: '', selectedProjectId: '', projectSessions: [], projectLoading: false, projectError: '',
  messages: [], tools: [], requests: [], draft: '', delivery: 'draft', execution: 'idle',
  stopUnknown: false, lastSync: null, epoch: '', syncWarning: '', listLoading: false, submitInProgress: false,
  sessionLoading: false, exclusiveSubmit: false, attachment: null, imageQueue: 'unavailable', imageDiagnostic: '', imageSelecting: false, imageTurnVersion: false, imageCapabilities: null,
  featureMethods: [], principalId: '', featureBusy: false, generationAllowed: false, generationReason: 'この接続先から生成の許可範囲を確認できません。閲覧・端末内編集のみ利用できます。',
  document: null, documentCapabilities: null, documentDiagnostic: '',
});

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
function text(value: unknown): string { return typeof value === 'string' ? value : ''; }
function finite(value: unknown): number | null { return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null; }
function sessionRows(raw: unknown): RemoteSession[] {
  const seen = new Set<string>();
  return (Array.isArray(raw) ? raw : []).flatMap(value => {
    const row = record(value);
    const id = text(row.id) || text(row.session_id);
    if (!id || seen.has(id)) return [];
    seen.add(id);
    return [{ durableId: id, lineageId: text(row.resolved_id) || id, title: text(row.title) || '無題の会話', source: text(row.source),
      lastActive: finite(row.last_active) ?? finite(row.started_at), messageCount: finite(row.message_count) }];
  });
}
function projectRows(raw: unknown): RemoteProject[] {
  const seen = new Set<string>();
  return (Array.isArray(raw) ? raw : []).flatMap(value => {
    const row = record(value);
    const id = text(row.id);
    if (!id || seen.has(id)) return [];
    seen.add(id);
    const kind: RemoteProject['kind'] = row.isNoProject === true ? 'unassigned' : row.isAuto === true ? 'automatic' : 'registered';
    return [{ id, label: kind === 'unassigned' ? 'プロジェクトなし' : text(row.label) || '名前のないプロジェクト', kind,
      sessionCount: finite(row.sessionCount) ?? 0, lastActive: finite(row.lastActive),
      sessionIds: (Array.isArray(row.sessionIds) ? row.sessionIds : []).filter((id): id is string => typeof id === 'string'),
      previews: sessionRows(row.previewSessions) }];
  });
}
function messagesFrom(raw: unknown): RemoteMessage[] {
  return (Array.isArray(raw) ? raw : []).filter(value => record(value).display_kind !== 'hidden').map((value, index) => {
    const row = record(value);
    return { id: String(row.row_id ?? `history-${index}`), role: text(row.role), text: text(row.text) || text(row.content) };
  }).filter(message => Boolean(message.text));
}
function isAuthFailure(error: unknown): boolean {
  return error instanceof HermesHttpError && (error.status === 401 || error.status === 403);
}

function connectionFailure(error: unknown, stage: ConnectionPhase): { kind: ConnectionFailure; diagnostic: string } {
  if (error instanceof HermesHttpError) {
    if (error.status === 401) return { kind: 'auth_401', diagnostic: 'HTTP 401: Hermesの認証が必要です。既存ログイン画面で再認証してください。' };
    if (error.status === 403) return { kind: 'forbidden_403', diagnostic: 'HTTP 403: 接続または操作が拒否されました。既存の権限・Origin設定を確認してください。' };
    if (error.status === 404) return { kind: 'version_mismatch', diagnostic: '必要なAPIが見つかりません。対象Hermesの版と通信契約を確認してください。' };
    return { kind: 'http', diagnostic: `HTTP ${error.status}: サーバーへの要求が失敗しました。` };
  }
  if (record(error).code === -32601 || error instanceof SyntaxError) return { kind: 'version_mismatch', diagnostic: '対象Hermesの通信契約に対応できません。必要なAPI・RPCの版を確認してください。' };
  if (error instanceof Error && /timed out|timeout/i.test(error.message)) return { kind: 'timeout', diagnostic: 'この接続段階でタイムアウトしました。VPNと到達性を確認して再接続してください。' };
  if (stage === 'wss' || stage === 'gateway') return { kind: 'websocket', diagnostic: 'HTTPSの取得後、WSSまたはgateway.readyの確認に失敗しました。VPN・端末のネットワーク権限を確認してください。新しいticketで再接続します。' };
  if (stage === 'rpc') return { kind: 'rpc', diagnostic: 'WSS接続後の読み取りRPCを確認できませんでした。対象版とアクセス権を確認してください。' };
  return { kind: 'network_or_tls', diagnostic: 'ネットワークまたはTLSの失敗です。ブラウザから原因を区別できません。VPN・証明書・HTTPSの到達性を確認してください。' };
}

/** Single adapter for all production HTTP, JSON-RPC, scope and in-memory state. */
export class RemoteController {
  readonly store = createStore<RemoteState>(() => initialState());
  private gateway: RemoteGateway | null = null;
  private scope = 0;
  private socketGeneration = 0;
  private operation = 0;
  private stopped = false;
  private signedOut = false;
  private connecting: Promise<void> | null = null;
  private syncInFlight: Promise<void> | null = null;
  private syncKey = '';
  private retryTimer: ReturnType<typeof setTimeout> | undefined;
  private retryAttempt = 0;
  private replies = new Map<string, ServerRequest>();
  private lastSeq = new Map<string, number>();
  private sendBusy = false;
  private stopBusy = false;
  private eventRevision = 0;
  private projectsRevision = 0;
  private projectRevision = 0;

  constructor(private readonly options: RemoteOptions) {}
  get imageTransferAvailable(): boolean { const state = this.store.getState(); return state.imageTurnVersion && state.imageCapabilities?.enabled === true && state.connection === 'connected'; }
  get imageLimit(): number {
    const caps = this.store.getState().imageCapabilities;
    return imageRawLimit(caps ? { backendBytes: caps.max_raw_bytes, websocketBytes: caps.max_frame_bytes, proxyBytes: caps.max_frame_bytes } : undefined);
  }
  get imageSelectionGeneration(): string { return `${this.scope}:${this.socketGeneration}:${this.operation}`; }
  get documentTransferAvailable(): boolean { const state = this.store.getState(); return state.generationAllowed && state.documentCapabilities?.enabled === true; }
  get documentLimit(): number { return documentLimits(this.store.getState().documentCapabilities ?? undefined).rawBytes; }
  get featureScopeKey(): string { const s = this.store.getState(); return `${this.options.origin}:${s.principalId}:${s.profile}:${this.imageSelectionGeneration}:${s.liveId}`; }
  private patch(next: Partial<RemoteState>): void { this.store.setState(next); }
  private valid(scope: number, gateway: RemoteGateway | null): boolean {
    return !this.stopped && !this.signedOut && this.scope === scope && this.gateway === gateway;
  }

  async start(): Promise<void> {
    const previous = this.connecting;
    this.stopped = false;
    this.signedOut = false;
    this.retryAttempt = 0;
    if (previous) await previous;
    if (this.stopped) return;
    await this.connect();
  }

  private async connect(): Promise<void> {
    if (this.stopped || this.signedOut) return;
    if (this.store.getState().connection === 'connected') return;
    if (this.connecting) return this.connecting;
    this.connecting = this.establish();
    try { await this.connecting; } finally { this.connecting = null; }
  }

  private async establish(): Promise<void> {
    const scope = this.scope;
    const generation = ++this.socketGeneration;
    const current = (): boolean => !this.stopped && !this.signedOut && this.scope === scope && this.socketGeneration === generation;
    try {
      this.patch({ connection: 'https', diagnostic: '', failureKind: '', failedStage: 'idle' });
      if (!this.options.secure) {
        this.patch({ connection: 'unsupported', diagnostic: 'HTTPSで開いてください。証明書の検証は解除しません。' });
        return;
      }
      this.patch({ https: true, connection: 'auth' });
      const status = await this.options.http<Record<string, unknown>>('/api/status', { skipProfile: true });
      if (!current()) return;
      this.patch({ targetVersion: text(status.version) });
      await this.verifyAuth();
      if (!current()) return;
      this.patch({ authenticated: true });
      const rawProfiles = await this.options.http<unknown>('/api/profiles', { skipProfile: true });
      if (!current()) return;
      const profileRows = record(rawProfiles).profiles;
      const profiles = (Array.isArray(profileRows) ? profileRows : []).map(item => text(record(item).name)).filter(Boolean);
      if (!profiles.includes(this.store.getState().profile)) {
        this.patch({ connection: 'unsupported', diagnostic: '選択profileが登録されていません。Dashboardで登録内容を確認してください。', profiles });
        return;
      }
      this.patch({ profiles, connection: 'ticket' });
      const { ticket } = await this.options.http<{ ticket: string }>('/api/auth/ws-ticket', { method: 'POST', skipProfile: true });
      if (!current()) return;
      if (!ticket) throw new Error('ticket_missing');
      const profile = this.store.getState().profile;
      // Reuse the official replay watermarks for this profile, with a fresh ticket on every dial.
      if (!this.gateway) this.installGateway(this.options.makeGateway(profile), scope);
      // The shell factory consumes this new ticket even when the gateway instance is reused.
      const gateway = this.gateway;
      if (!gateway) return;
      gateway.setTicket(ticket);
      this.patch({ connection: 'wss', wss: false, gatewayReady: false, readRpc: false });
      const wsUrl = new URL('/api/ws', this.options.origin);
      wsUrl.protocol = 'wss:';
      // Credentials travel through the shell's subprotocol factory, never through this URL.
      const ready = this.waitForReady(gateway);
      try { await gateway.connect(wsUrl.href); await ready.promise; } finally { ready.dispose(); }
      if (!current()) return;
      this.patch({ wss: true, gatewayReady: true, connection: 'rpc' });
      const capabilities = await gateway.request<{ per_session_exclusive_submit?: boolean }>('gateway.capabilities');
      if (!current()) return;
      if (capabilities.per_session_exclusive_submit !== true) {
        this.patch({ connection: 'unsupported', diagnostic: '対象サーバーの同時送信制御を確認できません。更新した公式版との契約を確認してください。' });
        gateway.close();
        return;
      }
      this.patch({ exclusiveSubmit: true, imageTurnVersion: record(capabilities).image_turn_version === 1 });
      if (record(capabilities).remote_web_version === 1) {
        const feature = await gateway.request<{ version: number; principal_id: string; methods: string[]; generation_allowed: boolean; generation_reason: string }>('remote.app.capabilities', { profile });
        if (!current()) return;
        if (feature.version !== 1 || !/^[a-f0-9]{64}$/.test(feature.principal_id) || !Array.isArray(feature.methods)) throw new SyntaxError('Invalid app capabilities');
        const previous = this.store.getState().principalId;
        if (previous && previous !== feature.principal_id) {
          // A fresh authenticated identity cannot inherit a prior person's subscription,
          // speculative input or transcript, even when the origin/profile stayed the same.
          this.operation++; this.replies.clear(); this.lastSeq.clear();
          this.patch({ liveId: '', durableId: '', lineageId: '', draft: '', messages: [], tools: [], requests: [],
            attachment: null, document: null, documentCapabilities: null, documentDiagnostic: '', imageCapabilities: null, imageDiagnostic: '',
            delivery: 'draft', execution: 'idle', sessions: [], projects: [], projectSessions: [], selectedProjectId: '',
            epoch: '', stopUnknown: false, syncWarning: '認証利用者が変わりました。以前の会話・下書き・添付を閉じました。' });
        }
        this.patch({ principalId: feature.principal_id,
          featureMethods: feature.version === 1 ? feature.methods.filter(name => name.startsWith('remote.')) : [],
          generationAllowed: feature.generation_allowed === true, generationReason: feature.generation_reason || '' });
      } else {
        if (this.store.getState().principalId) {
          this.operation++; this.replies.clear(); this.lastSeq.clear();
          this.patch({ liveId: '', durableId: '', lineageId: '', draft: '', messages: [], tools: [], requests: [], attachment: null, document: null,
            imageCapabilities: null, documentCapabilities: null, imageDiagnostic: '', documentDiagnostic: '', delivery: 'draft', execution: 'idle' });
        }
        this.patch({ featureMethods: [], principalId: '', generationAllowed: false, generationReason: 'このHermes版では生成の許可範囲を確認できません。新版Webからの送信は行いません。' });
      }
      await this.refreshSessions();
      if (!current()) return;
      if (this.store.getState().liveId) await this.synchronize();
      if (!current()) return;
      this.retryAttempt = 0;
      if (this.retryTimer) clearTimeout(this.retryTimer);
      this.retryTimer = undefined;
      this.patch({ connection: 'connected', readRpc: true, lastSync: Date.now(), diagnostic: '' });
    } catch (error) {
      if (!current()) return;
      const failedStage = this.store.getState().connection;
      const failure = connectionFailure(error, failedStage);
      if (isAuthFailure(error)) {
        this.clearSensitive();
        this.patch({ connection: 'reauth', authenticated: false, failureKind: failure.kind, failedStage, diagnostic: failure.diagnostic });
        this.signedOut = true;
        this.options.onLocalLogout?.();
        this.gateway?.close();
      } else {
        this.gateway?.close();
        this.patch({ connection: 'error', wss: false, gatewayReady: false, readRpc: false,
          failureKind: failure.kind, failedStage, diagnostic: failure.diagnostic });
        this.scheduleRetry();
      }
    }
  }

  private waitForReady(gateway: RemoteGateway): { promise: Promise<void>; dispose(): void } {
    let dispose = (): void => {};
    const promise = new Promise<void>((resolve, reject) => {
      const unsubscribe = gateway.onAny(event => { if (event.type === 'gateway.ready') resolve(); });
      const timer = setTimeout(() => reject(new Error('gateway_ready_timeout')), 15_000);
      dispose = () => { clearTimeout(timer); unsubscribe(); };
    });
    // A failed socket handshake must not leave an unobserved ready rejection.
    void promise.catch(() => undefined);
    return { promise, dispose: () => dispose() };
  }

  private installGateway(gateway: RemoteGateway, scope: number): void {
    this.gateway = gateway;
    gateway.onAny(event => { if (this.valid(scope, gateway)) this.onEvent(event); });
    gateway.onRequest(request => {
      if (!this.valid(scope, gateway)) return false;
      this.onRequest(request);
      return true;
    });
    gateway.onState(state => {
      if (this.valid(scope, gateway) && state === 'open') this.patch({ connection: 'gateway', wss: true });
      if (!this.valid(scope, gateway) || (state !== 'closed' && state !== 'error')) return;
      if (['unsupported', 'offline'].includes(this.store.getState().connection)) return;
      if (this.connecting && this.store.getState().connection !== 'connected') return;
      const delivery = this.store.getState().delivery;
      this.patch({ connection: 'reconnecting', wss: false, gatewayReady: false, readRpc: false,
        sessionLoading: false,
        execution: this.store.getState().liveId ? 'unknown' : 'idle',
        ...(delivery === 'sending' ? { delivery: 'delivery_unknown' as const } : {}) });
      this.scheduleRetry();
    });
  }

  private scheduleRetry(): void {
    if (this.retryTimer || this.stopped || this.signedOut || this.retryAttempt >= 8) return;
    if (['unsupported', 'offline'].includes(this.store.getState().connection)) return;
    const delay = Math.min(30_000, 1000 * 2 ** this.retryAttempt++) + Math.floor(Math.random() * 250);
    this.retryTimer = setTimeout(() => {
      this.retryTimer = undefined;
      if (this.store.getState().connection !== 'connected') void this.connect();
    }, delay);
  }

  async recover(online = true): Promise<void> {
    if (this.stopped || this.signedOut) return;
    if (!online) {
      this.socketGeneration++;
      this.patch({ connection: 'offline', execution: this.store.getState().liveId ? 'unknown' : 'idle' });
      this.gateway?.close();
      if (this.retryTimer) clearTimeout(this.retryTimer);
      this.retryTimer = undefined;
      return;
    }
    if (this.connecting) return this.connecting;
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = undefined;
    this.retryAttempt = 0;
    this.socketGeneration++;
    this.gateway?.close();
    await this.connect();
  }

  async selectProfile(profile: string): Promise<void> {
    if (!this.store.getState().profiles.includes(profile) || profile === this.store.getState().profile) return;
    if (this.sendBusy || this.stopBusy || this.hasScopeWork()) return;
    const previous = this.connecting;
    this.scope++;
    this.operation++;
    this.socketGeneration++;
    this.gateway?.close();
    this.gateway = null;
    this.replies.clear();
    this.lastSeq.clear();
    this.patch({ ...initialState(), profile, profiles: this.store.getState().profiles });
    if (previous) await previous;
    await this.connect();
  }

  async refreshSessions(): Promise<void> {
    const gateway = this.gateway;
    const scope = this.scope;
    const generation = this.socketGeneration;
    if (!gateway) return;
    this.patch({ listLoading: true });
    try {
      const state = this.store.getState();
      const result = state.featureMethods.includes('remote.sessions.list')
        ? await gateway.request<ConversationPage>('remote.sessions.list', { profile: state.profile, limit: 50 })
        : await gateway.request<SessionListResult>('session.list', { profile: state.profile, limit: 100 });
      if (!this.valid(scope, gateway) || this.socketGeneration !== generation) return;
      if (!Array.isArray(result.sessions)) throw new Error('session_list_contract_mismatch');
      this.patch({ sessions: sessionRows(result.sessions), listLoading: false });
    } catch (error) {
      if (this.valid(scope, gateway) && this.socketGeneration === generation) this.patch({ listLoading: false, diagnostic: '会話一覧を取得できませんでした。再接続してください。' });
      throw error;
    }
  }

  /** Optional profile-scoped read projection; never changes the server's active project. */
  async refreshProjects(): Promise<void> {
    const gateway = this.gateway;
    const scope = this.scope;
    const generation = this.socketGeneration;
    if (!gateway || this.store.getState().connection !== 'connected') return;
    const revision = ++this.projectsRevision;
    const current = (): boolean => this.valid(scope, gateway) && this.socketGeneration === generation && revision === this.projectsRevision;
    this.patch({ projectsStatus: 'loading', projectsError: '' });
    try {
      const result = await gateway.request<ProjectsTreeResult>('projects.tree', {
        profile: this.store.getState().profile, preview_limit: 3, session_limit: 100,
      });
      if (!current()) return;
      if (!Array.isArray(result.projects)) throw new Error('project_contract_mismatch');
      const projects = projectRows(result.projects);
      this.patch({ projects, projectsStatus: 'ready' });
      const selected = this.store.getState().selectedProjectId;
      if (selected) await this.selectProject(projects.some(project => project.id === selected) ? selected : '');
    } catch (error) {
      if (!current()) return;
      this.patch({ projectsStatus: record(error).code === -32601 ? 'unsupported' : 'error', projectsError:
        record(error).code === -32601 ? 'このHermes版はプロジェクト一覧に未対応です。最近の会話を利用できます。'
          : 'プロジェクト一覧を確認できませんでした。再取得してください。最近の会話は引き続き利用できます。' });
    }
  }

  async selectProject(projectId: string): Promise<void> {
    const gateway = this.gateway;
    const scope = this.scope;
    const generation = this.socketGeneration;
    const state = this.store.getState();
    if (projectId && (!gateway || state.connection !== 'connected' || !state.projects.some(project => project.id === projectId))) return;
    const revision = ++this.projectRevision;
    this.patch({ selectedProjectId: projectId, projectSessions: [], projectLoading: Boolean(projectId), projectError: '' });
    if (!projectId || !gateway) return;
    const current = (): boolean => this.valid(scope, gateway) && this.socketGeneration === generation
      && this.projectRevision === revision && this.store.getState().selectedProjectId === projectId;
    try {
      const result = await gateway.request<ProjectsProjectSessionsResult>('projects.project_sessions', {
        profile: state.profile, project_id: projectId, session_limit: 100,
      });
      if (!current()) return;
      if (!result.project || result.project.id !== projectId || !Array.isArray(result.project.repos)) throw new Error('project_no_longer_available');
      const rows = result.project.repos.flatMap(repo => (repo.groups || []).flatMap(group => group.sessions || []));
      const sessions = sessionRows(rows).sort((a, b) => (b.lastActive || 0) - (a.lastActive || 0));
      this.patch({ projectSessions: sessions, projectLoading: false });
    } catch {
      if (current()) this.patch({ projectLoading: false, projectError: 'このプロジェクトの会話を確認できませんでした。再取得するか、最近の会話へ戻ってください。' });
    }
  }

  async openSession(durableId?: string): Promise<void> {
    const gateway = this.gateway;
    const scope = this.scope;
    const generation = this.socketGeneration;
    const state = this.store.getState();
    if (!gateway || state.connection !== 'connected' || this.hasScopeWork() || this.sendBusy || this.stopBusy) return;
    const operation = ++this.operation;
    this.patch({ sessionLoading: true, diagnostic: '' });
    try {
      const result = await this.options.withOperationLock(async () => durableId
        ? await gateway.request<LiveSessionSnapshot>('session.resume', {
          session_id: durableId, profile: state.profile, lazy: true, inline_images: false, close_on_disconnect: false,
        })
        : await gateway.request<SessionCreateResult>('session.create', { profile: state.profile, close_on_disconnect: false, ...(state.featureMethods.length ? { lazy: true } : {}) }));
      if (!result) {
        this.patch({ sessionLoading: false, diagnostic: '別タブが操作中です。会話を作成・再開していません。' });
        return;
      }
      if (!this.valid(scope, gateway) || this.socketGeneration !== generation || this.operation !== operation) return;
      this.replies.forEach((request, key) => { if (request.params.session_id !== result.session_id) this.replies.delete(key); });
      this.patch({ liveId: result.session_id, durableId: result.stored_session_id || '', lineageId: durableId || result.stored_session_id || '',
        messages: [], tools: [], requests: this.store.getState().requests.filter(request => request.sessionId === result.session_id),
        draft: '', document: null, documentCapabilities: null, documentDiagnostic: '', attachment: null, imageDiagnostic: '', imageCapabilities: null, delivery: durableId && [state.durableId, state.lineageId].includes(durableId) ? state.delivery : 'draft', execution: 'idle', stopUnknown: false, sessionLoading: false });
      this.applySnapshot(result);
      await this.synchronize();
    } catch {
      if (this.valid(scope, gateway) && this.socketGeneration === generation && this.operation === operation) this.patch({ sessionLoading: false,
        diagnostic: '会話の作成・再開を確認できませんでした。一覧を再取得してください。自動再作成はしません。' });
    }
  }

  setDraft(draft: string): void {
    this.patch({ draft, ...(this.store.getState().delivery === 'failed_before_send' ? { delivery: 'draft' as const } : {}) });
  }

  /** One scoped operation port for optional features. No API probing or write retry. */
  async featureRequest<T>(method: string, params: Record<string, unknown> = {}, write = false): Promise<T> {
    const state = this.store.getState(), gateway = this.gateway;
    const scope = this.scope, generation = this.socketGeneration, operation = this.operation;
    if (!gateway || state.connection !== 'connected' || !state.featureMethods.includes(method)) throw new Error('このサーバーでは未対応です。');
    if (write && (state.featureBusy || this.sendBusy || this.stopBusy || state.sessionLoading || state.delivery === 'delivery_unknown')) throw new Error('現在の操作の結果を先に確認してください。');
    const current = (): boolean => this.valid(scope, gateway) && generation === this.socketGeneration && operation === this.operation
      && this.store.getState().profile === state.profile && this.store.getState().liveId === state.liveId;
    const perform = async (): Promise<T> => {
      if (!current()) throw new Error('会話の対象が変わりました。');
      const result = await gateway.request<T>(method, { ...params, profile: state.profile });
      if (!current()) throw new Error('対象または接続が変わったため結果を確認できません。再照会してください。自動再実行しません。');
      return result;
    };
    if (!write) return perform();
    this.patch({ featureBusy: true });
    try {
      const result = await this.options.withOperationLock(perform);
      if (result === undefined) throw new Error('別タブが操作中です。自動再実行しません。');
      return result;
    } finally { if (this.valid(scope, gateway)) this.patch({ featureBusy: false }); }
  }

  /** Adopt only the live snapshot returned by the scoped project operation. */
  async adoptCreatedSession(result: { session_id: string; stored_session_id?: string; profile: string }): Promise<void> {
    const state = this.store.getState();
    if (result.profile !== state.profile || !result.session_id || state.connection !== 'connected' || this.hasScopeWork()) return;
    this.operation++;
    this.patch({ liveId: result.session_id, durableId: result.stored_session_id || '', lineageId: result.stored_session_id || '',
      draft: '', messages: [], tools: [], requests: [], document: null, documentCapabilities: null, documentDiagnostic: '', attachment: null, imageCapabilities: null, imageDiagnostic: '', delivery: 'draft', execution: 'idle', sessionLoading: false });
    await this.synchronize();
  }

  hasScopeWork(): boolean {
    const state = this.store.getState();
    return state.featureBusy || state.sessionLoading || state.imageSelecting || Boolean(state.draft) || Boolean(state.attachment) || Boolean(state.document) || ['foreign', 'unknown', 'checking'].includes(state.imageQueue) || state.delivery === 'sending'
      || ['running', 'waiting_input', 'stop_requested'].includes(state.execution)
      || state.requests.some(card => card.profile === state.profile && card.sessionId === state.liveId && ['pending', 'checking', 'response_unknown'].includes(card.status));
  }

  async submit(): Promise<void> {
    const state = this.store.getState(), gateway = this.gateway, scope = this.scope, generation = this.socketGeneration;
    const image = state.attachment;
    const document = state.document;
    if (!state.generationAllowed) { this.patch({ diagnostic: state.generationReason || 'このprofileの実生成は未確認です。', delivery: 'failed_before_send' }); return; }
    const current = (): boolean => this.valid(scope, gateway) && generation === this.socketGeneration
      && this.store.getState().profile === state.profile && this.store.getState().liveId === state.liveId;
    if (this.sendBusy || state.imageSelecting || state.delivery === 'delivery_unknown' || !state.draft.trim()) return;
    if (image && (!this.imageTransferAvailable || image.status !== 'selected')) {
      this.patch({ imageDiagnostic: image.status === 'delivery_unknown' ? '画像と本文の送信結果不明です。自動再送しません。' : IMAGE_UNAVAILABLE }); return;
    }
    if (document && (!this.documentTransferAvailable || document.status !== 'selected')) {
      this.patch({ documentDiagnostic: document.status === 'delivery_unknown' ? '資料と本文の送信結果不明です。自動再送しません。' : DOCUMENT_UNAVAILABLE }); return;
    }
    if (image && document || state.featureBusy) return;
    if (!gateway || state.connection !== 'connected' || !state.liveId) {
      this.patch({ delivery: 'failed_before_send', diagnostic: '送信前に接続を確認できませんでした。下書きはこのページのメモリに残っています。' }); return;
    }
    if (!['idle', 'completed', 'stopped'].includes(state.execution)) return;
    this.sendBusy = true; this.patch({ submitInProgress: true });
    let wrote = false, acknowledged = false;
    try {
      const obtained = await this.options.withOperationLock(async () => {
        await this.synchronize();
        if (!current() || !['idle', 'completed', 'stopped'].includes(this.store.getState().execution)) return false;
        const params = { session_id: state.liveId, profile: state.profile, text: state.draft,
          ...(state.imageTurnVersion ? { image: image ? { content_base64: imageBase64(image.bytes), filename: image.mime === 'image/png' ? 'remote-image.png' : 'remote-image.jpg' } : null } : {}) };
        if (document) {
          const caps = this.store.getState().documentCapabilities;
          if (!this.documentTransferAvailable || !caps) return false;
          const payload = documentSnapshot(document, state.draft, caps);
          Object.assign(params, { document: payload });
          this.patch({ document: { ...document, status: 'uploading' }, documentDiagnostic: '資料と本文を一緒に送信しています。受付・生成開始はまだ確認していません。' });
        }
        if (image) {
          const caps = this.store.getState().imageCapabilities;
          if (!this.imageTransferAvailable || !caps || !validateImageSelection(image, this.imageLimit)
            || Math.max(image.width, image.height) > caps.max_edge || image.width * image.height > caps.max_pixels) return false;
          const frameBytes = new TextEncoder().encode(JSON.stringify({ jsonrpc: '2.0', id: 'x'.repeat(128), method: 'prompt.submit', params })).byteLength;
          if (frameBytes > caps.max_frame_bytes || new TextEncoder().encode(state.draft).byteLength > caps.max_text_bytes) {
            this.patch({ imageDiagnostic: '画像・本文・base64・JSONを含む転送上限を超えています。転送していません。' }); return false;
          }
          this.patch({ attachment: { ...image, status: 'uploading' }, imageDiagnostic: '画像と本文を一緒に送信しています。受付・生成開始はまだ確認していません。' });
        }
        this.patch({ delivery: 'sending', diagnostic: '' }); wrote = true;
        const result = await gateway.request<PromptSubmitResult & { document_turn?: DocumentTurnReceipt }>('prompt.submit', params);
        if (!current()) {
          if (this.valid(scope, gateway) && this.store.getState().liveId === state.liveId) this.patch({ delivery: 'delivery_unknown',
            ...(document ? { document: { ...document, status: 'delivery_unknown' }, documentDiagnostic: '接続世代が変わり資料と本文の受付は不明です。自動再送しません。' } : {}),
            ...(image ? { attachment: { ...image, status: 'delivery_unknown' }, imageDiagnostic: '接続世代が変わったため画像と本文の受付を確定できません。自動再送しません。' } : {}) });
          return false;
        }
        if (document && (!result.document_turn?.receipt_id || result.status !== 'streaming'
          || result.document_turn.bytes !== document.bytes.byteLength || result.document_turn.format !== document.format
          || result.document_turn.truncated !== false)) {
          this.patch({ delivery: 'delivery_unknown', execution: 'unknown', document: { ...document, status: 'delivery_unknown' },
            documentDiagnostic: '資料と当該本文ターンの受付証拠を確定できません。自動再送しません。' }); return false;
        }
        if (image && (!result.image_turn?.receipt_id || result.status !== 'streaming' || result.image_turn.bytes !== image.bytes.byteLength
          || result.image_turn.width !== image.width || result.image_turn.height !== image.height
          || result.image_turn.format !== (image.mime === 'image/png' ? 'PNG' : 'JPEG'))) {
          this.patch({ delivery: 'delivery_unknown', execution: 'unknown', attachment: { ...image, status: 'delivery_unknown' },
            imageDiagnostic: '画像と当該本文ターンの受付証拠を確定できません。自動再送しません。' }); return false;
        }
        acknowledged = true;
        // The official ACK binds this fixed caption to a persisted row. Do not infer
        // acceptance from matching text or invent a row for a lost/invalid ACK.
        const userRowId = result.user_row_id;
        const messages = [...this.store.getState().messages];
        if (Number.isSafeInteger(userRowId) && userRowId! > 0 && !messages.some(message => message.id === String(userRowId))) {
          const next = messages.findIndex(message => ['live-assistant', 'inflight-assistant'].includes(message.id)
            || /^\d+$/.test(message.id) && Number(message.id) > userRowId!);
          messages.splice(next < 0 ? messages.length : next, 0, { id: String(userRowId), role: 'user', text: state.draft });
        }
        this.patch({ delivery: 'accepted', draft: this.store.getState().draft === state.draft ? '' : this.store.getState().draft,
          messages,
          execution: this.store.getState().execution === 'completed' ? 'completed' : image || document ? 'unknown' : 'running' });
        if (document) this.patch({ document: { ...document, status: 'accepted' }, documentDiagnostic: '資料検査と本文ターンへの受付を確認しました。生成開始・完了は実行状態で確認します。' });
        if (image) this.patch({ attachment: { ...image, status: 'accepted' }, imageDiagnostic: '画像検査と本文ターンへの受付を確認しました。生成開始・完了は実行状態で確認します。' });
        await this.synchronize(); return true;
      });
      if (obtained === undefined) this.patch({ diagnostic: '別タブが操作中です。操作の所有権は取得していません。' });
    } catch (error) {
      if (this.valid(scope, gateway) && this.store.getState().liveId === state.liveId) {
        const rejected = current() && [-32601, -32602, 4000, 4009, 4090, 4091, 4120, 4121, 4124, 4130, 4131, 4132, 4133, 5035, 5070, 5071].includes(record(error).code as number);
        this.patch({ delivery: acknowledged ? 'accepted' : rejected || !wrote ? 'failed_before_send' : 'delivery_unknown',
          execution: rejected ? 'idle' : wrote ? 'unknown' : this.store.getState().execution,
          diagnostic: acknowledged ? '受付済みです。実行状態を再同期してください。' : rejected ? 'サーバーが送信を拒否しました。下書きは残しています。' : wrote ? '送信結果不明です。自動再送しません。' : '送信前の確認に失敗しました。下書きは残っています。' });
        if (image && wrote && !acknowledged) this.patch({ attachment: { ...image, status: rejected ? 'selected' : 'delivery_unknown' },
          imageDiagnostic: rejected ? '画像と本文は拒否されました。端末内の選択と下書きを保持しています。' : '画像と本文の送信結果不明です。自動再送・登録取消は行いません。' });
        if (document && wrote && !acknowledged) this.patch({ document: { ...document, status: rejected ? 'selected' : 'delivery_unknown' },
          documentDiagnostic: rejected ? '資料と本文は拒否されました。下書きと端末内の選択を保持します。' : '資料と本文の送信結果不明です。自動再送しません。' });
      }
    } finally { this.sendBusy = false; this.patch({ submitInProgress: false }); }
  }

  async synchronize(): Promise<void> {
    const key = `${this.scope}:${this.socketGeneration}:${this.operation}:${this.store.getState().liveId}`;
    if (this.syncInFlight && this.syncKey === key) return this.syncInFlight;
    this.syncKey = key;
    const pending = this.readSnapshot();
    this.syncInFlight = pending;
    try { await pending; } finally { if (this.syncInFlight === pending) this.syncInFlight = null; }
  }

  private async readSnapshot(): Promise<void> {
    const gateway = this.gateway;
    const scope = this.scope;
    const generation = this.socketGeneration;
    const operation = this.operation;
    const state = this.store.getState();
    if (!gateway || !state.liveId) return;
    await this.verifyAuth();
    if (!this.valid(scope, gateway) || this.socketGeneration !== generation) return;
    await gateway.awaitSessionReplay(state.liveId);
    const replay = await gateway.request<SessionEventsSinceResult>('session.events.since', {
      session_id: state.liveId, profile: state.profile, last_seen: gateway.getSeqWatermarks()[state.liveId] ?? 0,
    });
    if (!this.valid(scope, gateway) || this.socketGeneration !== generation || this.operation !== operation || this.store.getState().liveId !== state.liveId) return;
    const epochChanged = Boolean(this.store.getState().epoch && replay.epoch !== this.store.getState().epoch);
    if (replay.truncated || epochChanged) this.patch({ syncWarning: 'イベントの保持範囲またはサーバー世代が変わりました。保存済み履歴・状態を再取得しました。' });
    // A snapshot replaces speculative replay rendering and recovers even a truncated ring.
    const requestKeysAtStart = new Set(this.store.getState().requests.map(card => card.key));
    const revision = this.eventRevision;
    const result = await gateway.request<LiveSessionSnapshot>('session.activate', { session_id: state.liveId, profile: state.profile });
    if (!this.valid(scope, gateway) || this.socketGeneration !== generation || this.operation !== operation || this.store.getState().liveId !== state.liveId) return;
    if (this.eventRevision === revision) this.applySnapshot(result);
    this.reconcileRequests(result.open_requests ?? replay.open_requests ?? [], state.liveId, requestKeysAtStart);
    this.patch({ epoch: replay.epoch, lastSync: Date.now() });
    await this.inspectImages();
    await this.inspectDocuments();
  }

  /** Selection is local-only. The shell validates actual bytes before bounded decoding. */
  setImageSelecting(value: boolean, profile: string, liveId: string): void {
    const state = this.store.getState();
    if (state.profile === profile && state.liveId === liveId && !['logged_out', 'reauth'].includes(state.connection)) this.patch({ imageSelecting: value });
  }
  selectImage(image: ImageSelection, profile: string, liveId: string, generation = this.imageSelectionGeneration): boolean {
    const state = this.store.getState();
    if (this.sendBusy || state.attachment || state.document || generation !== this.imageSelectionGeneration || profile !== state.profile || liveId !== state.liveId || !liveId
      || ['reauth', 'logged_out'].includes(state.connection) || !validateImageSelection(image, this.imageLimit)) return false;
    this.patch({ attachment: { ...image, bytes: image.bytes.slice(), status: 'selected' }, imageDiagnostic: this.imageTransferAvailable ? '端末内で選択しました。まだ転送していません。' : IMAGE_UNAVAILABLE });
    return true;
  }

  private async inspectImages(): Promise<void> {
    const state = this.store.getState(), scope = this.scope, generation = this.socketGeneration, gateway = this.gateway;
    if (!state.liveId || !state.imageTurnVersion || !gateway) return;
    try {
      const caps = await gateway.request<ImageTurnCapabilities>('image.turn_capabilities', { profile: state.profile, session_id: state.liveId });
      if (!this.valid(scope, gateway) || generation !== this.socketGeneration || this.store.getState().liveId !== state.liveId) return;
      const valid = caps.version === 1 && [caps.max_raw_bytes, caps.max_frame_bytes, caps.max_text_bytes, caps.max_edge, caps.max_pixels]
        .every(value => Number.isSafeInteger(value) && value > 0);
      this.patch({ imageCapabilities: valid ? caps : null });
      if (this.store.getState().attachment?.status === 'accepted' && ['completed', 'stopped', 'failed'].includes(this.store.getState().execution)) {
        this.patch({ attachment: null, imageDiagnostic: '' });
      }
    } catch { if (this.valid(scope, gateway) && generation === this.socketGeneration) this.patch({ imageCapabilities: null }); }
  }

  async cancelImage(): Promise<void> {
    const image = this.store.getState().attachment;
    // With atomic image turns there is no uploaded-but-unsubmitted image queue to detach.
    if (!this.sendBusy && image?.status === 'selected') this.patch({ attachment: null, imageDiagnostic: '' });
  }

  selectDocument(document: DocumentSelection, profile: string, liveId: string, generation = this.imageSelectionGeneration): boolean {
    const state = this.store.getState();
    if (this.sendBusy || state.document || state.attachment || !liveId || generation !== this.imageSelectionGeneration
      || profile !== state.profile || liveId !== state.liveId || ['reauth', 'logged_out'].includes(state.connection)) return false;
    this.patch({ document: { ...document, bytes: document.bytes.slice(), status: 'selected' },
      documentDiagnostic: this.documentTransferAvailable ? '端末内で選択しました。まだ転送していません。画像解析とは異なるテキスト抽出です。' : DOCUMENT_UNAVAILABLE });
    return true;
  }

  cancelDocument(): void {
    if (!this.sendBusy && this.store.getState().document?.status === 'selected') this.patch({ document: null, documentDiagnostic: '' });
  }

  private async inspectDocuments(): Promise<void> {
    const state = this.store.getState(), gateway = this.gateway, scope = this.scope, generation = this.socketGeneration;
    if (!gateway || !state.liveId || !state.featureMethods.includes('remote.documents.capabilities')) return;
    try {
      const caps = await gateway.request<DocumentCapabilities>('remote.documents.capabilities', { profile: state.profile, session_id: state.liveId });
      if (!this.valid(scope, gateway) || generation !== this.socketGeneration || this.store.getState().liveId !== state.liveId) return;
      const valid = caps.version === 1 && caps.extraction === 'text_only' && Array.isArray(caps.formats)
        && [caps.max_raw_bytes, caps.max_frame_bytes, caps.max_text_bytes, caps.max_extracted_bytes, caps.max_pages, caps.model_input_max_bytes].every(value => Number.isSafeInteger(value) && value > 0);
      this.patch({ documentCapabilities: valid ? caps : null });
      if (this.store.getState().document?.status === 'accepted' && ['completed', 'stopped', 'failed'].includes(this.store.getState().execution)) this.patch({ document: null, documentDiagnostic: '' });
    } catch { if (this.valid(scope, gateway) && generation === this.socketGeneration) this.patch({ documentCapabilities: null }); }
  }

  private applySnapshot(result: LiveSessionSnapshot | SessionCreateResult): void {
    const snapshot = result as LiveSessionSnapshot;
    const running = snapshot.running ?? result.info.running;
    const wasStopping = this.stopBusy || ['stop_requested', 'stopped'].includes(this.store.getState().execution) || this.store.getState().stopUnknown;
    const inflight = snapshot.inflight;
    const messages = messagesFrom(result.messages);
    if (inflight?.user && !messages.some(message => message.id === String(inflight.user_row_id))) {
      messages.push({ id: 'inflight-user', role: 'user', text: inflight.user });
    }
    if (inflight?.assistant) messages.push({ id: 'inflight-assistant', role: 'assistant', text: inflight.assistant });
    const pending = (snapshot.open_requests ?? []).some(request => request.method === 'approval' || request.method === 'clarify');
    this.patch({ messages, durableId: result.stored_session_id || result.info.stored_session_id || this.store.getState().durableId,
      execution: pending ? 'waiting_input' : running ? (this.stopBusy ? 'stop_requested' : 'running') : inflight?.error ? 'failed' : wasStopping ? 'stopped' : this.store.getState().execution === 'completed' ? 'completed' : 'idle',
      stopUnknown: running ? this.store.getState().stopUnknown : false, lastSync: Date.now() });
  }

  private onRequest(request: ServerRequest): void {
    const state = this.store.getState();
    const sessionId = text(request.params.session_id);
    const key = requestKey(request.id);
    const card: RemoteRequest = { key, id: request.id, method: request.method, profile: state.profile,
      sessionId, params: request.params, status: 'pending' };
    const previous = state.requests.find(item => item.key === key);
    if (!previous || JSON.stringify(previous.params) !== JSON.stringify(request.params)) this.eventRevision++;
    if (previous?.status === 'response_unknown') card.status = 'response_unknown';
    const malformed = (request.method === 'approval' && (!Array.isArray(request.params.choices) || !request.params.choices.some(choice => choice === 'once' || choice === 'deny')))
      || (request.method === 'clarify' && (!Array.isArray(request.params.questions) || request.params.questions.length === 0 || request.params.questions.some(question => !text(record(question).qid) || !text(record(question).question))));
    if ((request.method !== 'approval' && request.method !== 'clarify') || malformed) {
      request.fail(-32601, 'Hermes Remote Web does not support this request');
      card.status = 'unsupported';
    } else {
      this.replies.set(key, request);
    }
    this.patch({ requests: [...state.requests.filter(item => item.key !== key), card].slice(-100),
      ...(sessionId === state.liveId && card.status === 'pending' ? { execution: 'waiting_input' as const } : {}) });
    if (sessionId === state.liveId && card.status === 'unsupported') this.syncAfterRequestChange();
  }

  private reconcileRequests(open: LiveSessionSnapshot['open_requests'], sessionId: string, keysAtStart: Set<string>): void {
    const keys = new Set((open ?? []).map(request => requestKey(request.id)));
    this.patch({ requests: this.store.getState().requests.map(card => {
      if (card.sessionId !== sessionId || card.status === 'unsupported' || card.status === 'cancelled') return card;
      if (!keys.has(card.key) && keysAtStart.has(card.key)) {
        this.replies.delete(card.key);
        return { ...card, status: 'resolved' as const };
      }
      return card;
    }) });
  }

  async answer(key: string, response: Record<string, unknown>): Promise<void> {
    const before = this.store.getState();
    const original = before.requests.find(card => card.key === key);
    const gateway = this.gateway;
    const scope = this.scope;
    if (!gateway || before.connection !== 'connected' || !original || original.status !== 'pending' || original.profile !== before.profile || original.sessionId !== before.liveId) return;
    if (!this.responseFor(original, response)) return;
    this.setRequestStatus(key, 'checking');
    try {
      const obtained = await this.options.withOperationLock(async () => {
        await this.synchronize();
        if (!this.valid(scope, gateway)) return false;
        const card = this.store.getState().requests.find(item => item.key === key);
        const request = this.replies.get(key);
        if (!card || card.status !== 'pending' || card.profile !== before.profile || card.sessionId !== this.store.getState().liveId || !request) return false;
        if (card.method === 'approval' && JSON.stringify(card.params) !== JSON.stringify(original.params)) {
          this.patch({ diagnostic: '承認対象が変わりました。最新の内容を確認してから回答してください。' });
          return false;
        }
        const verified = this.responseFor(card, response);
        if (!verified) return false;
        request.respond(verified);
        this.setRequestStatus(key, 'response_unknown');
        // A response frame has no ACK. Only fresh authoritative open_requests resolves the card.
        await this.synchronize();
        return true;
      });
      if (obtained === undefined) this.setRequestStatus(key, 'pending');
    } catch {
      if (this.valid(scope, gateway)) {
        this.setRequestStatus(key, 'response_unknown');
        this.patch({ diagnostic: '回答の受理を確認できません。同期して確認してください。自動再回答はしません。' });
      }
    }
  }

  private responseFor(card: RemoteRequest, response: Record<string, unknown>): Record<string, unknown> | null {
    if (card.method === 'approval') return ['once', 'deny'].includes(text(response.choice)) && Array.isArray(card.params.choices) && card.params.choices.includes(response.choice)
      ? { choice: response.choice } : null;
    if (card.method !== 'clarify' || !Array.isArray(card.params.questions)) return null;
    const answers = record(response.answers);
    const accepted = record(card.params.answers);
    const entries = card.params.questions.map(item => {
      const qid = text(record(item).qid);
      return [qid, qid in accepted ? accepted[qid] : answers[qid]] as const;
    });
    if (entries.some(([qid, value]) => !qid || (value !== null && typeof value !== 'string'))) return null;
    return { answers: Object.fromEntries(entries) };
  }

  private setRequestStatus(key: string, status: RemoteRequest['status']): void {
    this.patch({ requests: this.store.getState().requests.map(card => card.key === key ? { ...card, status } : card) });
  }

  private syncAfterRequestChange(forceSnapshot = false): void {
    const gateway = this.gateway;
    const scope = this.scope;
    const generation = this.socketGeneration;
    const operation = this.operation;
    const liveId = this.store.getState().liveId;
    void this.synchronize().then(async () => {
      if (!this.valid(scope, gateway) || this.socketGeneration !== generation || this.operation !== operation || this.store.getState().liveId !== liveId) return;
      const state = this.store.getState();
      // A cancellation may race the first snapshot. Read once more, without replaying any response.
      if (forceSnapshot || ['running', 'waiting_input', 'unknown'].includes(state.execution)
        && !state.requests.some(card => card.sessionId === liveId && ['pending', 'checking', 'response_unknown'].includes(card.status))) await this.synchronize();
    }).catch(() => {
      if (this.valid(scope, gateway) && this.socketGeneration === generation && this.operation === operation) this.patch({ diagnostic: '要求の解決後の実行状態を確認できません。再同期してください。' });
    });
  }

  async stop(): Promise<void> {
    const state = this.store.getState();
    const gateway = this.gateway;
    const scope = this.scope;
    if (!gateway || state.connection !== 'connected' || !state.liveId || !['running', 'waiting_input'].includes(state.execution) || this.stopBusy) return;
    this.stopBusy = true;
    this.patch({ execution: 'stop_requested', stopUnknown: false });
    try {
      const obtained = await this.options.withOperationLock(async () => {
        await this.verifyAuth();
        if (!this.valid(scope, gateway)) return false;
        await gateway.request('session.interrupt', { session_id: state.liveId, profile: state.profile });
        if (this.valid(scope, gateway) && this.store.getState().liveId === state.liveId) await this.synchronize();
        return true;
      });
      if (obtained === undefined) this.patch({ execution: 'unknown', diagnostic: '別タブが操作中です。停止要求は送っていません。' });
    } catch {
      if (this.valid(scope, gateway)) this.patch({ execution: 'unknown', stopUnknown: true,
        diagnostic: '停止要求の結果不明です。再同期で状態を確認してください。' });
    } finally { this.stopBusy = false; }
  }

  private onEvent(event: GatewayEvent): void {
    const payload = record(event.payload);
    const state = this.store.getState();
    if (event.type === 'gateway.ready') {
      const epoch = text(payload.replay_epoch);
      if (epoch && state.epoch && state.epoch !== epoch) {
        this.lastSeq.clear();
        this.patch({ syncWarning: 'サーバー世代が変わりました。履歴と未回答要求を再取得します。' });
      }
      this.patch({ epoch: epoch || state.epoch, connection: 'gateway' });
      return;
    }
    if (event.session_id !== state.liveId || !state.liveId) return;
    if (typeof event.seq === 'number') {
      const key = `${state.epoch}:${state.profile}:${state.liveId}`;
      if (event.seq <= (this.lastSeq.get(key) ?? 0)) return;
      this.lastSeq.set(key, event.seq);
    }
    // Informational events that do not change this projection cannot invalidate a
    // newer authoritative history read (e.g. usage/title events after completion).
    if (!['request.cancel', 'message.start', 'message.delta', 'message.complete', 'session.info', 'tool.start', 'tool.complete'].includes(event.type)) return;
    this.eventRevision++;
    if (event.type === 'request.cancel') {
      const key = typeof payload.id === 'string' || typeof payload.id === 'number' ? requestKey(payload.id) : '';
      this.replies.delete(key);
      this.setRequestStatus(key, payload.reason === 'resolved' ? 'resolved' : 'cancelled');
      this.syncAfterRequestChange();
    } else if (event.type === 'message.start') {
      this.patch({ execution: 'running', messages: [...state.messages.filter(message => message.id !== 'live-assistant'), { id: 'live-assistant', role: 'assistant', text: '' }] });
    } else if (event.type === 'message.delta') {
      const index = state.messages.findIndex(message => message.id === 'live-assistant' || message.id === 'inflight-assistant');
      const messages = [...state.messages];
      if (index < 0) messages.push({ id: 'live-assistant', role: 'assistant', text: text(payload.text) });
      else if (messages[index]) messages[index] = { ...messages[index], text: messages[index].text + text(payload.text) };
      this.patch({ messages });
    } else if (event.type === 'message.complete') {
      const status = text(payload.status);
      const rowId = record(payload.persisted_turn).final_assistant_row_id;
      const finalId = Number.isSafeInteger(rowId) ? String(rowId) : `completed-${this.socketGeneration}-${this.eventRevision}`;
      this.patch({ ...(state.attachment?.status === 'accepted' ? { attachment: null, imageDiagnostic: '' } : {}), ...(state.document?.status === 'accepted' ? { document: null, documentDiagnostic: '' } : {}), execution: status === 'interrupted' ? 'stopped' : status === 'error' ? 'failed' : 'completed',
        messages: state.messages.map(message => message.id === 'live-assistant' || message.id === 'inflight-assistant' ? { ...message, id: finalId, text: text(payload.text) || message.text } : message) });
      // Completion can race the submit-time read. Once it settles, take one fresh read, never resend.
      this.syncAfterRequestChange(true);
    } else if (event.type === 'session.info') {
      this.patch({ durableId: text(payload.stored_session_id) || state.durableId });
    } else if (event.type === 'tool.start' || event.type === 'tool.complete') {
      const id = text(payload.tool_id);
      const tool: RemoteTool = { id, name: text(payload.name),
        detail: text(payload.result_text) || text(payload.summary) || text(payload.context) || (payload.args ? JSON.stringify(payload.args) : ''),
        status: event.type === 'tool.start' ? '実行中' : '完了' };
      this.patch({ tools: [...state.tools.filter(item => item.id !== id), tool].slice(-200) });
    }
  }

  private clearSensitive(): void {
    this.replies.clear();
    this.lastSeq.clear();
    this.patch({ ...initialState(), targetVersion: this.store.getState().targetVersion });
  }

  private async verifyAuth(): Promise<void> {
    try {
      await this.options.http('/api/auth/me', { skipProfile: true });
    } catch (error) {
      if (isAuthFailure(error)) {
        this.signedOut = true;
        this.scope++;
        this.socketGeneration++;
        this.gateway?.close();
        this.gateway = null;
        if (this.retryTimer) clearTimeout(this.retryTimer);
        this.retryTimer = undefined;
        this.options.onLocalLogout?.();
        this.clearSensitive();
        const failure = connectionFailure(error, 'auth');
        this.patch({ connection: 'reauth', failureKind: failure.kind, failedStage: 'auth', diagnostic: failure.diagnostic });
      }
      throw error;
    }
  }

  /** Other tabs hide their memory without replaying the server logout request. */
  hideLocalSession(): void {
    this.signedOut = true;
    this.scope++;
    this.socketGeneration++;
    this.gateway?.close();
    this.gateway = null;
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = undefined;
    this.options.onLocalLogout?.();
    this.clearSensitive();
    this.patch({ connection: 'logged_out', diagnostic: '端末内のアプリ内容を隠しました。Hermesの認証セッションをログアウトしています。' });
  }

  async logout(): Promise<void> {
    this.hideLocalSession();
    try {
      await this.options.http('/auth/logout', { method: 'POST', skipProfile: true });
      this.patch({ diagnostic: 'Hermesのログアウトを実施しました。同じ認証を使うDashboardにも影響します。' });
    } catch {
      this.patch({ diagnostic: '端末内の内容は消去しました。サーバーのログアウトは未確認です。既存Dashboardのログアウトも確認してください。' });
    }
  }

  dispose(): void {
    this.stopped = true;
    this.scope++;
    this.socketGeneration++;
    this.gateway?.close();
    this.gateway = null;
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = undefined;
    this.clearSensitive();
  }
}
