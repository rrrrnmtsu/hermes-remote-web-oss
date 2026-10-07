/** R06/R07/R14/R15 ports. This module owns no transport, React or persistent store. */
export interface ConversationMetadata {
  session_id: string;
  title: string;
  pinned: boolean;
  archived: boolean;
  version: string;
}
export interface ConversationListItem extends ConversationMetadata {
  started_at: number;
  parent_session_id: string | null;
}
export interface ConversationPage {
  sessions: ConversationListItem[];
  next_cursor: string | null;
  order: 'created_desc';
  scope: 'owned_profile_sessions';
  limit: number;
  snapshot_time: number;
}
export interface ConversationQuery {
  cursor?: string;
  query?: string;
  from_time?: number;
  to_time?: number;
  project_id?: string;
  archive?: 'active' | 'archived' | 'all';
  limit?: number;
}
export interface UserTemplate {
  id: string;
  name: string;
  category: string;
  body: string;
  version: number;
  updated_at: number;
}
export interface UserTemplateList {
  templates: UserTemplate[];
  limit: number;
  body_limit: number;
  storage_scope: 'authenticated_owner_profile_server';
}
export interface UserTemplateInput {
  id?: string;
  expected_version?: number;
  name: string;
  category: string;
  body: string;
}
export type BranchMode = 'branch' | 'edit' | 'regenerate';
export interface ConversationBranch {
  stored_session_id: string;
  parent_session_id: string;
  source_row_id: number;
  message_count: number;
  draft: string;
  mode: BranchMode;
  generation_started: false;
  inheritance: 'visible_user_assistant_prefix_with_parent_system_context';
}
export const CONVERSATION_METHODS = [
  'remote.sessions.list', 'remote.session.metadata', 'remote.session.organize',
  'remote.session.branch_from_row', 'remote.templates.list', 'remote.templates.put', 'remote.templates.remove',
] as const;
export type ConversationMethod = typeof CONVERSATION_METHODS[number];
export interface ConversationOperationPort {
  list(query?: ConversationQuery): Promise<ConversationPage>;
  metadata(sessionId: string): Promise<ConversationMetadata>;
  organize(session: ConversationMetadata, changes: { title?: string; pinned?: boolean; archived?: boolean }): Promise<ConversationMetadata>;
  templates(): Promise<UserTemplateList>;
  putTemplate(input: UserTemplateInput): Promise<UserTemplate>;
  removeTemplate(template: UserTemplate): Promise<void>;
  branch(sessionId: string, rowId: number, mode: BranchMode): Promise<ConversationBranch>;
}
export interface ConversationRpcPort {
  /** Include origin, authenticated principal, profile and socket generation in key. */
  scope(): { key: string; profile: string } | null;
  supports(method: ConversationMethod): boolean;
  request(method: ConversationMethod, params: Record<string, unknown>): Promise<unknown>;
}

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('会話データの形式を確認できません。');
  return value as Record<string, unknown>;
}
function metadata(value: unknown): ConversationMetadata {
  const row = object(value);
  if (typeof row.session_id !== 'string' || typeof row.title !== 'string' || typeof row.version !== 'string'
    || typeof row.pinned !== 'boolean' || typeof row.archived !== 'boolean') throw new Error('会話の変更結果を確認できません。');
  return row as unknown as ConversationMetadata;
}
function template(value: unknown): UserTemplate {
  const row = object(value);
  if (typeof row.id !== 'string' || typeof row.name !== 'string' || typeof row.category !== 'string'
    || typeof row.body !== 'string' || row.body.length > 8000 || typeof row.version !== 'number'
    || !Number.isInteger(row.version) || row.version < 1 || typeof row.updated_at !== 'number') throw new Error('定型文の変更結果を確認できません。');
  return row as unknown as UserTemplate;
}

/** Adapter passes its single gateway operation entry; no retry or generation fallback. */
export class ConversationFeatureClient implements ConversationOperationPort {
  private writing = false;
  constructor(private readonly port: ConversationRpcPort) {}
  private async call(method: ConversationMethod, params: Record<string, unknown>, write = false): Promise<unknown> {
    const scope = this.port.scope();
    if (!scope || !this.port.supports(method)) throw new Error('現在の接続先はこの会話操作に対応していません。');
    if (write && this.writing) throw new Error('前の会話操作の結果を待ってください。');
    if (write) this.writing = true;
    try {
      const result = await this.port.request(method, { ...params, profile: scope.profile });
      if (this.port.scope()?.key !== scope.key) throw new Error('接続先または会話の範囲が変わったため、古い結果を反映しません。');
      return result;
    } finally { if (write) this.writing = false; }
  }
  async list(query: ConversationQuery = {}): Promise<ConversationPage> {
    const result = object(await this.call('remote.sessions.list', { limit: 50, ...query }));
    if (!Array.isArray(result.sessions) || result.sessions.length > 100 || result.order !== 'created_desc'
      || result.scope !== 'owned_profile_sessions' || typeof result.limit !== 'number' || typeof result.snapshot_time !== 'number'
      || result.next_cursor !== null && typeof result.next_cursor !== 'string') throw new Error('履歴の取得範囲を確認できません。');
    for (const item of result.sessions) {
      const row = object(item); metadata(row);
      if (typeof row.started_at !== 'number' || row.parent_session_id !== null && typeof row.parent_session_id !== 'string') throw new Error('履歴の形式を確認できません。');
    }
    return result as unknown as ConversationPage;
  }
  async metadata(sessionId: string): Promise<ConversationMetadata> {
    return metadata(object(await this.call('remote.session.metadata', { session_id: sessionId })).session);
  }
  async organize(session: ConversationMetadata, changes: { title?: string; pinned?: boolean; archived?: boolean }): Promise<ConversationMetadata> {
    const result = metadata(object(await this.call('remote.session.organize', {
      session_id: session.session_id, expected_version: session.version, ...changes,
    }, true)).session);
    if (result.session_id !== session.session_id || result.version === session.version
      || Object.entries(changes).some(([key, value]) => result[key as keyof ConversationMetadata] !== value)) throw new Error('会話の変更結果が一致しません。再取得して確認してください。');
    return result;
  }
  async templates(): Promise<UserTemplateList> {
    const result = object(await this.call('remote.templates.list', {}));
    if (!Array.isArray(result.templates) || result.templates.length > 50 || result.storage_scope !== 'authenticated_owner_profile_server') throw new Error('定型文の保存範囲を確認できません。');
    result.templates.forEach(template);
    return result as unknown as UserTemplateList;
  }
  async putTemplate(input: UserTemplateInput): Promise<UserTemplate> {
    if (!input.name.trim() || input.name.length > 100 || input.category.length > 50 || !input.body.trim() || input.body.length > 8000) throw new Error('定型文の名前・本文と上限を確認してください。');
    const result = template(object(await this.call('remote.templates.put', { ...input }, true)).template);
    if (result.body !== input.body || result.name !== input.name.trim() || input.id && result.id !== input.id) throw new Error('保存した定型文を確認できません。');
    return result;
  }
  async removeTemplate(value: UserTemplate): Promise<void> {
    const result = object(await this.call('remote.templates.remove', { id: value.id, expected_version: value.version }, true));
    if (result.removed !== value.id || result.version !== value.version) throw new Error('定型文の削除結果を確認できません。');
  }
  async branch(sessionId: string, rowId: number, mode: BranchMode): Promise<ConversationBranch> {
    if (!Number.isInteger(rowId) || rowId < 1) throw new Error('保存済みの発言だけを分岐できます。');
    const result = object(await this.call('remote.session.branch_from_row', { session_id: sessionId, row_id: rowId, mode }, true));
    if (typeof result.stored_session_id !== 'string' || result.parent_session_id !== sessionId || result.source_row_id !== rowId
      || result.generation_started !== false || result.mode !== mode || typeof result.draft !== 'string'
      || typeof result.message_count !== 'number' || result.inheritance !== 'visible_user_assistant_prefix_with_parent_system_context') throw new Error('分岐結果を確認できません。自動で再実行しません。');
    return result as unknown as ConversationBranch;
  }
}

/** Keyset pages may overlap when a user manually refreshes; the canonical ID wins. */
export function appendConversationPage(previous: ConversationListItem[], page: ConversationPage): ConversationListItem[] {
  const known = new Set(previous.map(row => row.session_id));
  return [...previous, ...page.sessions.filter(row => !known.has(row.session_id) && !!known.add(row.session_id))];
}
