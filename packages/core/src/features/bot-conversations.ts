import { createStore } from 'zustand/vanilla';
import { parseConversationPage } from './conversations';
import { knownBotPlatform, type BotPlatform, type BotScope } from './bots';

export const BOT_CONVERSATION_PAGE_SIZE = 50;
export const BOT_CONVERSATION_MAX_PAGES = 4;
export const BOT_SOURCE_INDEX_LIMIT = 200;
export interface BotConversationScope extends BotScope { projectId: string; }
export interface BotConversation {
  id: string; title: string; titleTruncated: boolean; source: string | null;
  startedAt: number; pinned: boolean; archived: boolean;
}
export interface BotConversationPage {
  rows: BotConversation[]; nextCursor: string | null; snapshotTime: number; sourceIndexSize: number;
}
export interface BotConversationPort {
  readPage(scope: BotConversationScope, cursor: string | null, signal: AbortSignal): Promise<BotConversationPage>;
}
export interface BotConversationState {
  scope: BotConversationScope | null; available: boolean; load: 'idle' | 'loading' | 'ready' | 'error';
  rows: BotConversation[]; pages: number; nextCursor: string | null; snapshotTime: number | null;
  sourceIndexSize: number; stale: boolean; error: string;
}
const initial = (): BotConversationState => ({ scope: null, available: false, load: 'idle', rows: [], pages: 0,
  nextCursor: null, snapshotTime: null, sourceIndexSize: 0, stale: false, error: '' });
const scopeKey = (scope: BotConversationScope | null): string => scope
  ? JSON.stringify([scope.origin, scope.principal, scope.profile, scope.generation, scope.projectId]) : '';
function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

/** Only the owned cursor page supplies identities/titles. The bounded legacy list supplies source evidence for those exact IDs. */
export function projectBotConversationPage(owned: unknown, sourceIndex: unknown, profile: string): BotConversationPage {
  const page = parseConversationPage(owned);
  if (page.limit !== BOT_CONVERSATION_PAGE_SIZE || page.sessions.length > BOT_CONVERSATION_PAGE_SIZE
    || !Number.isFinite(page.snapshot_time) || page.snapshot_time < 0
    || page.next_cursor !== null && (!page.next_cursor.trim() || page.next_cursor.length > 2048)
    || page.next_cursor !== null && !page.sessions.length) throw new Error('bot_page_contract');
  const index = record(sourceIndex);
  if (!index || !Array.isArray(index.sessions) || index.sessions.length > BOT_SOURCE_INDEX_LIMIT) throw new Error('bot_source_index_contract');
  const ownedIds = new Set<string>();
  for (const row of page.sessions) {
    if (!row.session_id || row.session_id.length > 256 || !Number.isFinite(row.started_at) || row.started_at < 0) throw new Error('bot_row_contract');
    ownedIds.add(row.session_id);
  }
  // Other principals' IDs, titles/previews and arbitrary raw source metadata are never retained.
  const sources = new Map<string, string | null>();
  for (const value of index.sessions) {
    const row = record(value);
    if (!row || typeof row.id !== 'string' || !ownedIds.has(row.id)) continue;
    const normalized = typeof row.source === 'string' ? row.source.trim().toLowerCase() : '';
    const source = (row.profile === undefined || row.profile === profile) && /^[a-z][a-z0-9_-]{0,31}$/.test(normalized) ? normalized : null;
    sources.set(row.id, sources.has(row.id) && sources.get(row.id) !== source ? null : source);
  }
  const rows = page.sessions.filter((row, i, all) => all.findIndex(other => other.session_id === row.session_id) === i).map(row => ({
    id: row.session_id, title: row.title.trim() ? row.title.slice(0, 200) + (row.title.length > 200 ? '…' : '') : '無題の会話',
    titleTruncated: row.title.length > 200, source: sources.get(row.session_id) ?? null,
    startedAt: row.started_at, pinned: row.pinned, archived: row.archived,
  }));
  return { rows, nextCursor: page.next_cursor, snapshotTime: page.snapshot_time, sourceIndexSize: index.sessions.length };
}

/** Independent explicit reads: no mount/filter polling, automatic pagination or changes to the main list/draft. */
export class BotConversationsController {
  readonly store = createStore<BotConversationState>(() => initial());
  private revision = 0;
  private pending: AbortController | null = null;
  private seenCursors = new Set<string>();
  constructor(private readonly port: BotConversationPort) {}
  setScope(scope: BotConversationScope | null, available: boolean): void {
    const before = this.store.getState();
    if (scopeKey(scope) === scopeKey(before.scope) && available === before.available) return;
    this.cancel(); this.store.setState({ ...initial(), scope, available: Boolean(scope && available) });
  }
  cancel(): void {
    this.revision++; this.pending?.abort(); this.pending = null; this.seenCursors.clear();
    this.store.setState({ ...initial(), scope: this.store.getState().scope, available: this.store.getState().available });
  }
  async load(append = false): Promise<void> {
    const before = this.store.getState(), scope = before.scope;
    if (!scope || !before.available || this.pending
      || append && (before.stale || !before.nextCursor || before.pages >= BOT_CONVERSATION_MAX_PAGES)) return;
    const cursor = append ? before.nextCursor : null;
    const revision = ++this.revision, abort = new AbortController(); this.pending = abort;
    const current = (): boolean => revision === this.revision && !abort.signal.aborted
      && scopeKey(scope) === scopeKey(this.store.getState().scope);
    this.store.setState({ load: 'loading', error: '' });
    try {
      const page = await this.port.readPage(scope, cursor, abort.signal);
      if (!current()) return;
      if (append && page.snapshotTime !== before.snapshotTime) throw new Error('bot_snapshot_changed');
      const cursors = append ? this.seenCursors : new Set<string>();
      if (page.nextCursor && (page.nextCursor === cursor || cursors.has(page.nextCursor))) throw new Error('bot_cursor_repeated');
      if (page.nextCursor) cursors.add(page.nextCursor);
      this.seenCursors = cursors;
      const rows = append ? [...before.rows] : [];
      const ids = new Map(rows.map((row, i) => [row.id, i]));
      for (const row of page.rows) {
        const index = ids.get(row.id);
        if (index === undefined) { ids.set(row.id, rows.length); rows.push(row); }
        else if (rows[index]!.source !== row.source) rows[index] = { ...rows[index]!, source: null };
      }
      this.store.setState({ rows, pages: append ? before.pages + 1 : 1, nextCursor: page.nextCursor,
        snapshotTime: page.snapshotTime, sourceIndexSize: page.sourceIndexSize, stale: false, load: 'ready', error: '' });
    } catch {
      if (current()) this.store.setState({ load: 'error', stale: before.rows.length > 0,
        error: '会話の取得・所有者・ボット種別の照合を確認できませんでした。自動で再取得しません。最初から再取得してください。' });
    } finally { if (this.pending === abort) this.pending = null; }
  }
}

export function conversationBotSources(rows: readonly BotConversation[], platforms: readonly BotPlatform[]): string[] {
  return [...new Set([...platforms.map(row => row.id), ...rows.flatMap(row => row.source && knownBotPlatform(row.source) ? [row.source] : [])])].sort();
}
export function filterBotConversations(rows: readonly BotConversation[], sources: readonly string[], source: string, query: string): BotConversation[] {
  const permitted = new Set(sources), text = query.trim().toLocaleLowerCase('ja-JP');
  return rows.filter(row => row.source !== null && permitted.has(row.source) && (!source || row.source === source)
    && (!text || row.title.toLocaleLowerCase('ja-JP').includes(text)));
}
