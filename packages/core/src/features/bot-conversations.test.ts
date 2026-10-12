import { describe, expect, it, vi } from 'vitest';
import { BotConversationsController, conversationBotSources, filterBotConversations, projectBotConversationPage,
  type BotConversationPage, type BotConversationScope } from './bot-conversations';

const scope: BotConversationScope = { origin: 'https://demo.invalid', principal: 'DEMO-owner', profile: 'DEMO-profile', generation: '1', projectId: '' };
const owned = (id = 'DEMO-owned', extra = {}) => ({ session_id: id, title: 'DEMO 日本語 [.*]', version: '0.DEMO', pinned: false,
  archived: false, started_at: 10, parent_session_id: null, ...extra });
const rawPage = (sessions = [owned()], extra = {}) => ({ sessions, next_cursor: null, order: 'created_desc', scope: 'owned_profile_sessions', limit: 50, snapshot_time: 30, ...extra });
const page = (id = 'DEMO-owned', cursor: string | null = 'DEMO-next'): BotConversationPage => projectBotConversationPage(rawPage([owned(id)], { next_cursor: cursor }),
  { sessions: [{ id, source: 'discord' }] }, scope.profile);
function deferred<T>() { let resolve!: (value: T) => void; let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }

describe('owned bot conversation/source projection', () => {
  it('joins only exact owned IDs, using canonical owned titles and no preview, other-owner metadata or arbitrary response fields', () => {
    const result = projectBotConversationPage(rawPage(), { sessions: [
      { id: 'DEMO-owned', source: ' Discord ', title: 'DEMO-RAW-SECRET', preview: 'DEMO-RAW-SECRET', token: 'DEMO-RAW-SECRET' },
      { id: 'DEMO-other-owner', source: 'telegram', title: 'DEMO-RAW-SECRET' },
    ] }, scope.profile);
    expect(result.rows).toEqual([{ id: 'DEMO-owned', title: 'DEMO 日本語 [.*]', titleTruncated: false, source: 'discord', startedAt: 10, pinned: false, archived: false }]);
    expect(JSON.stringify(result)).not.toContain('DEMO-RAW-SECRET'); expect(JSON.stringify(result)).not.toContain('DEMO-other-owner');
  });
  it('does not infer source from a lineage alias, a foreign profile, duplicate disagreement or malformed names', () => {
    const result = projectBotConversationPage(rawPage([owned('alias'), owned('foreign'), owned('duplicate'), owned('bad'), owned('missing')]), { sessions: [
      { id: 'other', resolved_id: 'alias', source: 'discord' }, { id: 'foreign', source: 'discord', profile: 'another-profile' },
      { id: 'duplicate', source: 'discord' }, { id: 'duplicate', source: 'telegram' }, { id: 'duplicate', source: 'discord' },
      { id: 'bad', source: '<script>' },
    ] }, scope.profile);
    expect(result.rows.every(row => row.source === null)).toBe(true);
  });
  it('keeps a missing source unknown and a known non-bot source distinct from a bot', () => {
    const result = projectBotConversationPage(rawPage([owned('web'), owned('missing')]), { sessions: [{ id: 'web', source: 'tui' }] }, scope.profile);
    expect(result.rows.map(row => row.source)).toEqual(['tui', null]);
    expect(filterBotConversations(result.rows, conversationBotSources(result.rows, []), '', '')).toEqual([]);
  });
  it.each([
    { scope: 'all_profiles' }, { limit: 100 }, { snapshot_time: NaN }, { next_cursor: '' }, { next_cursor: 'x'.repeat(2049) },
  ])('rejects unsupported owned scope/page metadata %j', extra => {
    expect(() => projectBotConversationPage(rawPage([owned()], extra), { sessions: [] }, scope.profile)).toThrow();
  });
  it('rejects excessive pages/indexes, empty cursor pages, malformed indexes and invalid canonical identities/timestamps', () => {
    expect(() => projectBotConversationPage(rawPage(Array.from({ length: 51 }, (_, i) => owned('DEMO-'+i))), { sessions: [] }, scope.profile)).toThrow();
    expect(() => projectBotConversationPage(rawPage([], { next_cursor: 'DEMO-more' }), { sessions: [] }, scope.profile)).toThrow();
    expect(() => projectBotConversationPage(rawPage(), { sessions: Array(201).fill({}) }, scope.profile)).toThrow();
    expect(() => projectBotConversationPage(rawPage(), { sessions: {} }, scope.profile)).toThrow();
    expect(() => projectBotConversationPage(rawPage([owned('')]), { sessions: [] }, scope.profile)).toThrow();
    expect(() => projectBotConversationPage(rawPage([owned('ok', { started_at: Infinity })]), { sessions: [] }, scope.profile)).toThrow();
  });
  it('deduplicates owned IDs, clips only title display and treats arbitrary raw source rows as unavailable evidence', () => {
    const result = projectBotConversationPage(rawPage([owned('long', { title: 'あ'.repeat(201) }), owned('long'), owned('empty', { title: ' ' })]),
      { sessions: [null, [], { id: 'long', source: 'discord' }, { id: 'empty' }] }, scope.profile);
    expect(result.rows).toHaveLength(2); expect(result.rows[0]?.title).toBe('あ'.repeat(200)+'…'); expect(result.rows[0]?.titleTruncated).toBe(true);
    expect(result.rows[1]?.title).toBe('無題の会話'); expect(result.rows[1]?.source).toBeNull();
  });
  it('discovers confirmed historical known platforms even when stopped, and matches Japanese/symbols literally in loaded titles', () => {
    const result = projectBotConversationPage(rawPage([owned('discord'), owned('telegram', { title: 'DEMO 通常' }), owned('custom')]),
      { sessions: [{ id: 'discord', source: 'discord' }, { id: 'telegram', source: 'telegram' }, { id: 'custom', source: 'custom_bot' }] }, scope.profile);
    const sources = conversationBotSources(result.rows, []); expect(sources).toEqual(['discord', 'telegram']);
    expect(filterBotConversations(result.rows, sources, '', '[.*]').map(row => row.id)).toEqual(['discord']);
    expect(filterBotConversations(result.rows, sources, 'telegram', '通常').map(row => row.id)).toEqual(['telegram']);
    const custom = conversationBotSources(result.rows, [{ id: 'custom_bot', name: 'その他のボット', state: 'unknown', updatedAt: null }]);
    expect(filterBotConversations(result.rows, custom, 'custom_bot', '').map(row => row.id)).toEqual(['custom']);
    expect(filterBotConversations(result.rows, sources, '', '存在しない')).toEqual([]);
  });
});

describe('explicit, bounded memory-only bot history pages', () => {
  it('does not read on construction/scope/filter and makes one read per explicit first/next page', async () => {
    const readPage = vi.fn().mockResolvedValueOnce(page()).mockResolvedValueOnce(page('DEMO-second', null));
    const controller = new BotConversationsController({ readPage }); controller.setScope(scope, true);
    expect(readPage).not.toHaveBeenCalled(); await controller.load(); expect(readPage).toHaveBeenCalledTimes(1);
    expect(readPage.mock.calls[0]?.[0]).toEqual(scope); expect(readPage.mock.calls[0]?.[1]).toBeNull();
    expect(controller.store.getState().rows).toHaveLength(1);
    await controller.load(true); expect(readPage.mock.calls[1]?.[1]).toBe('DEMO-next'); expect(controller.store.getState().rows).toHaveLength(2);
    await controller.load(true); expect(readPage).toHaveBeenCalledTimes(2);
    controller.setScope({ ...scope }, true); expect(controller.store.getState().rows).toHaveLength(2);
  });
  it('blocks double activation and reaches a maximum of four manually loaded pages without auto-fetching', async () => {
    const pending = deferred<BotConversationPage>(); const readPage = vi.fn().mockReturnValueOnce(pending.promise);
    const controller = new BotConversationsController({ readPage }); controller.setScope(scope, true);
    const action = controller.load(); await controller.load(); await controller.load(true); expect(readPage).toHaveBeenCalledTimes(1);
    pending.resolve(page()); await action;
    for (let i = 2; i <= 4; i++) { readPage.mockResolvedValueOnce(page('DEMO-'+i, 'cursor-'+i)); await controller.load(true); }
    await controller.load(true); expect(readPage).toHaveBeenCalledTimes(4); expect(controller.store.getState().pages).toBe(4);
  });
  it.each(['origin', 'principal', 'profile', 'generation', 'projectId'] as const)('aborts/discards late results when %s changes', async field => {
    const pending = deferred<BotConversationPage>(); const readPage = vi.fn().mockReturnValue(pending.promise);
    const controller = new BotConversationsController({ readPage }); controller.setScope(scope, true);
    const action = controller.load(); controller.setScope({ ...scope, [field]: 'DEMO-new' }, true);
    expect(readPage.mock.calls[0]?.[2].aborted).toBe(true); pending.resolve(page()); await action;
    expect(controller.store.getState().rows).toEqual([]); expect(controller.store.getState().load).toBe('idle');
  });
  it('close/logout drops IDs/cursors and prevents an old reply from replacing a reopened list', async () => {
    const pending = deferred<BotConversationPage>(); const readPage = vi.fn().mockReturnValueOnce(pending.promise).mockResolvedValueOnce(page('new', null));
    const controller = new BotConversationsController({ readPage }); controller.setScope(scope, true);
    const action = controller.load(); controller.cancel(); await controller.load(); pending.reject(new Error('DEMO-secret')); await action;
    expect(controller.store.getState().rows[0]?.id).toBe('new'); expect(controller.store.getState().error).toBe('');
    controller.setScope(null, false); expect(controller.store.getState().rows).toEqual([]); expect(controller.store.getState().nextCursor).toBeNull();
  });
  it('keeps a read failure explicit/stale without automatic retry and refreshes only on another explicit first-page request', async () => {
    const readPage = vi.fn().mockResolvedValueOnce(page()).mockRejectedValueOnce(new Error('DEMO-secret')).mockResolvedValueOnce(page('refreshed', null));
    const controller = new BotConversationsController({ readPage }); controller.setScope(scope, true);
    await controller.load(); await controller.load(true); expect(controller.store.getState().stale).toBe(true);
    expect(controller.store.getState().error).not.toContain('DEMO-secret'); await controller.load(true); expect(readPage).toHaveBeenCalledTimes(2);
    await controller.load(); expect(controller.store.getState().stale).toBe(false); expect(controller.store.getState().rows[0]?.id).toBe('refreshed');
  });
  it.each(['snapshot', 'cursor'])('refuses an inconsistent %s page instead of restarting or guessing progress', async variant => {
    const first = page(); const bad = { ...page('second'), ...(variant === 'snapshot' ? { snapshotTime: 31 } : {}) };
    const readPage = vi.fn().mockResolvedValueOnce(first).mockResolvedValueOnce(bad);
    const controller = new BotConversationsController({ readPage }); controller.setScope(scope, true);
    await controller.load(); await controller.load(true);
    expect(controller.store.getState().load).toBe('error'); expect(controller.store.getState().rows).toHaveLength(1); expect(readPage).toHaveBeenCalledTimes(2);
  });
  it('deduplicates overlapping canonical IDs and downgrades conflicting source evidence instead of picking the first bot', async () => {
    const first = page(); const second = { ...page('DEMO-owned', null), rows: [{ ...first.rows[0]!, source: 'telegram' }] };
    const readPage = vi.fn().mockResolvedValueOnce(first).mockResolvedValueOnce(second);
    const controller = new BotConversationsController({ readPage }); controller.setScope(scope, true);
    await controller.load(); await controller.load(true); expect(controller.store.getState().rows).toHaveLength(1);
    expect(controller.store.getState().rows[0]?.source).toBeNull();
  });
  it('does not probe unsupported/missing scope or silently fall back after capability loss', async () => {
    const readPage = vi.fn(); const controller = new BotConversationsController({ readPage });
    await controller.load(); controller.setScope(scope, false); await controller.load(); await controller.load(true); expect(readPage).not.toHaveBeenCalled();
    controller.setScope(scope, true); readPage.mockResolvedValue(page()); await controller.load(); controller.setScope(scope, false);
    expect(controller.store.getState().rows).toEqual([]); await controller.load(); expect(readPage).toHaveBeenCalledTimes(1);
  });
});
