import { describe, expect, it, vi } from 'vitest';
import { appendConversationPage, ConversationFeatureClient, type ConversationMetadata, type ConversationPage, type ConversationRpcPort } from './conversations';

const session: ConversationMetadata = { session_id: 'DEMO-session', title: '合成会話', pinned: false, archived: false, version: '0.DEMO' };
const page: ConversationPage = { sessions: [{ ...session, started_at: 1, parent_session_id: null }],
  next_cursor: null, order: 'created_desc', limit: 50, scope: 'owned_profile_sessions', snapshot_time: 2 };
function fixture(result: unknown) {
  let scope = { key: 'DEMO-origin/owner/profile/socket', profile: 'DEMO-profile' };
  const request = vi.fn().mockResolvedValue(result);
  const port: ConversationRpcPort = { scope: () => scope, supports: () => true, request };
  return { client: new ConversationFeatureClient(port), request, port, switchScope: () => { scope = { key: 'DEMO-new', profile: 'other' }; } };
}

describe('bounded owned conversation operation port', () => {
  it('uses explicit profile and default bounded page without activation', async () => {
    const { client, request } = fixture(page);
    expect(await client.list()).toEqual(page);
    expect(request).toHaveBeenCalledWith('remote.sessions.list', { limit: 50, profile: 'DEMO-profile' });
  });
  it('rejects missing capability without probing phantom methods', async () => {
    const demo = fixture(page); demo.port.supports = () => false;
    await expect(demo.client.list()).rejects.toThrow('対応していません');
    expect(demo.request).not.toHaveBeenCalled();
  });
  it('isolates late results from profile/socket/principal changes', async () => {
    const demo = fixture(page);
    let resolve!: (result: unknown) => void;
    demo.request.mockImplementation(() => new Promise(done => { resolve = done; }));
    const waiting = demo.client.list(); demo.switchScope(); resolve(page);
    await expect(waiting).rejects.toThrow('古い結果');
    expect(demo.request).toHaveBeenCalledTimes(1);
  });
  it('checks organize readback and never retries a conflict or unknown ACK', async () => {
    const demo = fixture({ session: { ...session, title: '新会話名', version: '1.DEMO' } });
    expect((await demo.client.organize(session, { title: '新会話名' })).title).toBe('新会話名');
    expect(demo.request).toHaveBeenCalledWith('remote.session.organize', {
      session_id: session.session_id, expected_version: session.version, title: '新会話名', profile: 'DEMO-profile',
    });
    demo.request.mockRejectedValue(new Error('結果不明'));
    await expect(demo.client.organize(session, { pinned: true })).rejects.toThrow('結果不明');
    expect(demo.request).toHaveBeenCalledTimes(2);
  });
  it('blocks double tap writes while preserving the original target', async () => {
    const demo = fixture({ session }); let resolve!: (value: unknown) => void;
    demo.request.mockImplementation(() => new Promise(done => { resolve = done; }));
    const waiting = demo.client.organize(session, { pinned: true });
    await expect(demo.client.organize(session, { pinned: true })).rejects.toThrow('前の会話操作');
    resolve({ session: { ...session, pinned: true, version: '1.DEMO' } }); await waiting;
    expect(demo.request).toHaveBeenCalledTimes(1);
  });
  it('rejects a misleading mutation receipt', async () => {
    const demo = fixture({ session: { ...session, pinned: false, version: '1.DEMO' } });
    await expect(demo.client.organize(session, { pinned: true })).rejects.toThrow('一致しません');
  });
  it('deduplicates canonical page IDs without fetching more itself', () => {
    expect(appendConversationPage(page.sessions, page)).toHaveLength(1);
    const next = { ...page, sessions: [...page.sessions, { ...page.sessions[0]!, session_id: 'DEMO-next' }] };
    expect(appendConversationPage(page.sessions, next)).toHaveLength(2);
  });
  it('validates template bounds before any write', async () => {
    const demo = fixture({});
    await expect(demo.client.putTemplate({ name: 'test', category: '', body: 'x'.repeat(8001) })).rejects.toThrow('上限');
    expect(demo.request).not.toHaveBeenCalled();
  });
  it('creates only a stored branch and refuses forged generation metadata', async () => {
    const result = { stored_session_id: 'DEMO-child', parent_session_id: session.session_id, source_row_id: 4,
      message_count: 2, draft: '合成の下書き', mode: 'edit', generation_started: false,
      inheritance: 'visible_user_assistant_prefix_with_parent_system_context' };
    const demo = fixture(result);
    expect(await demo.client.branch(session.session_id, 4, 'edit')).toEqual(result);
    expect(demo.request).toHaveBeenCalledWith('remote.session.branch_from_row', {
      session_id: session.session_id, row_id: 4, mode: 'edit', profile: 'DEMO-profile',
    });
    demo.request.mockResolvedValue({ ...result, generation_started: true });
    await expect(demo.client.branch(session.session_id, 4, 'edit')).rejects.toThrow('分岐結果');
  });
});
