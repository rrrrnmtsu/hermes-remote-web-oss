import { createStore } from 'zustand/vanilla';

/** Only the central RemoteController supplies this port; views do not own HTTP/WS. */
export interface InformationScope { origin: string; principal: string; profile: string; liveId: string; durableId: string; generation: string; }
export interface InformationPort {
  request<T>(method: string, params: Record<string, unknown>): Promise<T>;
  canChangeModel(): boolean;
  canCreateSession(): boolean;
  withOperationLock<T>(action: () => Promise<T>): Promise<T | undefined>;
}
export type InformationTab = 'models' | 'agent' | 'commands' | 'cron' | 'activity';
export type InformationLoad = 'idle' | 'loading' | 'ready' | 'unsupported' | 'error';
export interface InformationModel { model: string; provider: string; current: boolean; listed: boolean; credential_present: boolean | null; response_confirmed: boolean | null; selectable: boolean; reason: string; }
export interface InformationModels { version: 1; revision: string; profile: string; session_id: string | null; model: string; provider: string; api_mode: string; endpoint_origin: string | null; rows: InformationModel[]; scope: 'configured_same_route'; truncated: boolean; }
export interface InformationUsage {
  source: 'live' | 'stored' | 'unknown'; input?: number | null; output?: number | null; reasoning?: number | null;
  cache_read?: number | null; cache_write?: number | null; total?: number | null; calls?: number | null; auxiliary_calls?: number | null;
  started_at?: number | null; completed_at?: number | null; elapsed_seconds?: number | null;
  estimated_cost_usd?: number | null; actual_cost_usd?: number | null; pricing_version?: string | null; pricing_source?: string | null; price_checked_at?: number | null; accounting_scope?: string;
  unit_input_usd_per_million?: number | null; unit_output_usd_per_million?: number | null;
  unit_cache_read_usd_per_million?: number | null; unit_cache_write_usd_per_million?: number | null;
}
export interface InformationNamedState { name: string; state: 'available' | 'configured' | 'disabled' | 'unknown'; }
export interface InformationSnapshot { version: 1; profile: string; session_id: string | null; model: string; provider: string; api_mode: string; tools: InformationNamedState[]; tools_state: string; skills: InformationNamedState[]; skills_state: string; mcp: InformationNamedState[]; mcp_state: string; usage: InformationUsage; observed_at: number; truncated: boolean; }
export interface InformationCommand { text: string; description: string; category: string; kind: 'command' | 'skill' | 'quick_command'; support: 'draft' | 'device_only' | 'management' | 'unsupported'; insertable: boolean; }
export interface InformationCommands { version: 1; profile: string; rows: InformationCommand[]; skills_state: string; truncated: boolean; }
export interface InformationCronJob { id: string; name: string; schedule: string; timezone: string | null; enabled: boolean | null; next_run_at: string | null; next_run_jst: string | null; last_run_at: string | null; last_run_jst: string | null; last_status: string | null; }
export interface InformationCronHistory { id: string; job_id: string; status: string; started_at: string | null; finished_at: string | null; started_jst: string | null; finished_jst: string | null; }
export interface InformationCron { version: 1; profile: string; state: string; history_state: string; jobs: InformationCronJob[]; history: InformationCronHistory[]; truncated: boolean; }
export interface InformationActivityRow { durable_id: string; live_id: string | null; title: string; state: 'running' | 'waiting_input' | 'completed' | 'failed' | 'idle' | 'unknown'; open_request_count: number; last_active: number | null; }
export interface InformationActivity { version: 1; profile: string; rows: InformationActivityRow[]; stored_state?: 'available' | 'unavailable'; observed_at: number; truncated: boolean; }
export interface InformationProjectSession { session_id: string; stored_session_id: string; profile: string; project: { id: string; name: string; cwd: string }; }
export interface InformationState {
  scope: InformationScope | null; load: Record<InformationTab, InformationLoad>; error: string; writing: boolean; modelWriteUnknown: boolean; projectWriteUnknown: boolean;
  models: InformationModels | null; agent: InformationSnapshot | null; commands: InformationCommands | null; cron: InformationCron | null; activity: InformationActivity | null;
}
const methods = { models: 'remote.info.models', agent: 'remote.info.snapshot', commands: 'remote.info.commands', cron: 'remote.info.cron', activity: 'remote.info.activity' } as const;
const initial = (): InformationState => ({ scope: null, load: { models: 'idle', agent: 'idle', commands: 'idle', cron: 'idle', activity: 'idle' }, error: '', writing: false, modelWriteUnknown: false, projectWriteUnknown: false, models: null, agent: null, commands: null, cron: null, activity: null });
function scopeKey(scope: InformationScope | null): string { return scope ? JSON.stringify([scope.origin, scope.principal, scope.profile, scope.liveId, scope.durableId, scope.generation]) : ''; }
function validEnvelope(value: unknown, scope: InformationScope, sessionBound: boolean): boolean {
  if (!value || typeof value !== 'object') return false;
  const envelope = value as { version?: unknown; profile?: unknown; session_id?: unknown };
  return envelope.version === 1 && envelope.profile === scope.profile && (!sessionBound || (envelope.session_id || '') === scope.liveId);
}

/** Memory-only feature state, bounded explicit reads and single-shot writes. No polling/retry. */
export class InformationController {
  readonly store = createStore<InformationState>(() => initial());
  private capabilities = new Set<string>();
  private revisions: Record<InformationTab, number> = { models: 0, agent: 0, commands: 0, cron: 0, activity: 0 };
  constructor(private readonly port: InformationPort) {}
  setScope(scope: InformationScope | null, supportedMethods: readonly string[] = []): void {
    const changed = scopeKey(scope) !== scopeKey(this.store.getState().scope);
    this.capabilities = new Set(supportedMethods);
    if (changed) {
      for (const tab of Object.keys(this.revisions) as InformationTab[]) this.revisions[tab]++;
      this.store.setState({ ...initial(), scope });
    }
  }
  clear(): void { this.setScope(null); }
  supports(method: string): boolean { return this.capabilities.has(method); }
  private current(scope: InformationScope): boolean { return scopeKey(scope) === scopeKey(this.store.getState().scope); }
  private patchLoad(tab: InformationTab, load: InformationLoad): void {
    this.store.setState(state => ({ load: { ...state.load, [tab]: load } }));
  }
  async load(tab: InformationTab, query = ''): Promise<void> {
    const scope = this.store.getState().scope;
    if (!scope) return;
    if (!this.supports(methods[tab])) { this.patchLoad(tab, 'unsupported'); return; }
    const revision = ++this.revisions[tab];
    this.patchLoad(tab, 'loading');
    this.store.setState({ error: '' });
    const sessionBound = tab === 'agent' || tab === 'models';
    const params: Record<string, unknown> = { profile: scope.profile };
    if (sessionBound || tab === 'commands') params.session_id = scope.liveId || null;
    if (tab === 'commands') { params.query = query.slice(0, 200); params.limit = 50; }
    if (tab === 'cron' || tab === 'activity') params.limit = 50;
    try {
      const result = await this.port.request<InformationModels | InformationSnapshot | InformationCommands | InformationCron | InformationActivity>(methods[tab], params);
      if (!this.current(scope) || revision !== this.revisions[tab]) return;
      if (!validEnvelope(result, scope, sessionBound)) throw new Error('scope_contract_mismatch');
      this.store.setState({ [tab]: result } as Partial<InformationState>);
      this.patchLoad(tab, 'ready');
    } catch {
      if (this.current(scope) && revision === this.revisions[tab]) {
        this.patchLoad(tab, 'error');
        this.store.setState({ error: '情報を確認できませんでした。読み取りを再実行できます。' });
      }
    }
  }
  async setModel(model: string): Promise<void> {
    const state = this.store.getState(), scope = state.scope;
    if (!scope?.liveId || state.writing || !state.models || state.modelWriteUnknown || !this.port.canChangeModel()
      || !this.supports('remote.session.model_set') || !state.models.rows.some(row => row.model === model && row.selectable)) return;
    const revision = state.models.revision;
    this.store.setState({ writing: true, error: '' });
    let entered = false;
    try {
      await this.port.withOperationLock(async () => {
        if (!this.current(scope) || !this.port.canChangeModel()) return;
        entered = true;
        const result = await this.port.request<InformationModels>('remote.session.model_set', { profile: scope.profile, session_id: scope.liveId, model, expected_revision: revision });
        if (!this.current(scope)) return;
        if (!validEnvelope(result, scope, true) || result.model !== model) throw new Error('model_readback_mismatch');
        this.store.setState({ models: result, modelWriteUnknown: false });
      });
    } catch {
      if (this.current(scope)) {
        this.store.setState({ modelWriteUnknown: entered, error: 'モデル変更の受付を確認できません。自動で再変更しません。現在値を再取得してください。' });
        await this.load('models');
      }
    } finally { if (this.current(scope)) this.store.setState({ writing: false }); }
  }
  /** A verified readback resolves UI uncertainty; it never reissues the model write. */
  async refreshModel(): Promise<void> {
    const scope = this.store.getState().scope;
    if (!scope) return;
    const revision = this.revisions.models + 1;
    await this.load('models');
    if (this.current(scope) && revision === this.revisions.models && this.store.getState().load.models === 'ready') {
      this.store.setState({ modelWriteUnknown: false });
    }
  }
  async createProjectSession(projectId: string): Promise<InformationProjectSession | undefined> {
    const state = this.store.getState(), scope = state.scope;
    if (!scope || state.writing || state.projectWriteUnknown || !projectId || !this.supports('remote.project.create_session') || !this.port.canCreateSession()) return;
    this.store.setState({ writing: true, error: '' });
    let entered = false;
    try {
      return await this.port.withOperationLock(async () => {
        if (!this.current(scope) || !this.port.canCreateSession()) return;
        entered = true;
        const result = await this.port.request<InformationProjectSession>('remote.project.create_session', { profile: scope.profile, project_id: projectId });
        if (!this.current(scope)) return;
        if (result.profile !== scope.profile || result.project?.id !== projectId || !result.project.cwd || !result.session_id || !result.stored_session_id) throw new Error('project_readback_mismatch');
        return result;
      });
    } catch {
      // Catalog reads cannot identify a lost creation ACK. Keep uncertainty
      // within its exact scope instead of offering the same write again.
      if (this.current(scope)) this.store.setState({ projectWriteUnknown: entered,
        error: '作業先を確認できませんでした。会話を自動で作り直しません。会話一覧から状態を確認してください。' });
    } finally { if (this.current(scope)) this.store.setState({ writing: false }); }
  }
}
