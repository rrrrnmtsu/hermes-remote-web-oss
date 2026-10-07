import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ConversationMetadata, ConversationOperationPort, ConversationPage, UserTemplate } from '../../../core/src/features/conversations';
import { ConversationToolsBranchDialog, ConversationToolsBrowser, ConversationToolsOrganization, ConversationToolsTemplates } from './ConversationTools';

const session: ConversationMetadata = { session_id: 'DEMO-session', title: '合成会話', pinned: false, archived: false, version: '0.DEMO' };
const page: ConversationPage = { sessions: [{ ...session, started_at: 1, parent_session_id: null }],
  next_cursor: 'DEMO-cursor', order: 'created_desc', limit: 50, scope: 'owned_profile_sessions', snapshot_time: 2 };
const item: UserTemplate = { id: 'DEMO-template', name: '合成定型文', body: '日本語の下書き\n改行', category: '調査', version: 1, updated_at: 1 };
function port(): ConversationOperationPort {
  return { list: vi.fn().mockResolvedValue(page), metadata: vi.fn().mockResolvedValue(session),
    organize: vi.fn().mockResolvedValue({ ...session, pinned: true, version: '1.DEMO' }),
    templates: vi.fn().mockResolvedValue({ templates: [item], limit: 50, body_limit: 8000, storage_scope: 'authenticated_owner_profile_server' }),
    putTemplate: vi.fn().mockResolvedValue(item), removeTemplate: vi.fn().mockResolvedValue(undefined),
    branch: vi.fn().mockResolvedValue({ stored_session_id: 'DEMO-child', parent_session_id: session.session_id,
      source_row_id: 2, message_count: 0, draft: '合成の下書き', mode: 'regenerate', generation_started: false }) };
}
beforeEach(() => {
  Object.defineProperty(HTMLDialogElement.prototype, 'showModal', { value: function(this: HTMLDialogElement) { this.open = true; }, configurable: true });
  Object.defineProperty(HTMLDialogElement.prototype, 'close', { value: function(this: HTMLDialogElement) { this.open = false; }, configurable: true });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe('conversation tools explicit operation UX', () => {
  it('loads one bounded page, explicitly adds another and only opens on user click', async () => {
    const operations = port(); const open = vi.fn();
    render(<ConversationToolsBrowser scopeKey="DEMO-A" profile="DEMO" port={operations} projects={[]} onOpen={open} onOrganize={() => undefined} />);
    await screen.findByText('合成会話'); expect(operations.list).toHaveBeenCalledTimes(1); expect(open).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '次の50件を取得' }));
    await waitFor(() => expect(operations.list).toHaveBeenCalledTimes(2));
    expect(operations.list).toHaveBeenLastCalledWith({ limit: 50, cursor: 'DEMO-cursor' });
    expect(screen.getAllByText('合成会話')).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: /合成会話.*1970/ })); expect(open).toHaveBeenCalledWith(session.session_id);
  });
  it('does not auto-search on typing or use regular expressions', async () => {
    const operations = port();
    render(<ConversationToolsBrowser scopeKey="DEMO-A" profile="DEMO" port={operations} projects={[]} onOpen={() => undefined} onOrganize={() => undefined} />);
    await screen.findByText('合成会話'); fireEvent.change(screen.getByLabelText('タイトル'), { target: { value: '日本語.*_100%' } });
    expect(operations.list).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: '条件を指定して取得' }));
    await waitFor(() => expect(operations.list).toHaveBeenLastCalledWith({ query: '日本語.*_100%', archive: 'active' }));
  });
  it('keeps both labeled native date inputs and retrieves the selected date range only on explicit search', async () => {
    const operations = port();
    render(<ConversationToolsBrowser scopeKey="DEMO-A" profile="DEMO" port={operations} projects={[]} onOpen={() => undefined} onOrganize={() => undefined} />);
    await screen.findByText('合成会話');
    expect(screen.getByRole('option', { name: 'すべての登録project範囲' })).toHaveValue('');
    expect(screen.getByLabelText('project')).toHaveValue('');
    const from = screen.getByLabelText('開始日'), to = screen.getByLabelText('終了日');
    expect(from).toHaveAttribute('type', 'date'); expect(to).toHaveAttribute('type', 'date');
    fireEvent.change(from, { target: { value: '2026-10-04' } });
    fireEvent.change(to, { target: { value: '2026-10-06' } });
    expect(from).toHaveValue('2026-10-04'); expect(to).toHaveValue('2026-10-06');
    expect(operations.list).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: '条件を指定して取得' }));
    await waitFor(() => expect(operations.list).toHaveBeenLastCalledWith({ query: '', archive: 'active',
      from_time: new Date('2026-10-04T00:00:00').getTime() / 1000,
      to_time: new Date('2026-10-06T23:59:59.999').getTime() / 1000 }));
    expect(operations.organize).not.toHaveBeenCalled(); expect(operations.branch).not.toHaveBeenCalled();
    expect(operations.putTemplate).not.toHaveBeenCalled(); expect(operations.removeTemplate).not.toHaveBeenCalled();
  });
  it('invalidates old page data on a different profile scope', async () => {
    const operations = port(); let resolve!: (value: ConversationPage) => void;
    vi.mocked(operations.list).mockImplementation(() => new Promise(done => { resolve = done; }));
    const props = { profile: 'DEMO', port: operations, projects: [], onOpen: () => undefined, onOrganize: () => undefined };
    const view = render(<ConversationToolsBrowser {...props} scopeKey="DEMO-A" />);
    const old = resolve; view.rerender(<ConversationToolsBrowser {...props} scopeKey="DEMO-B" />);
    await act(async () => old(page)); expect(screen.queryByText('合成会話')).toBeNull();
  });

  it('rejects an inverted date range without a read and clears date endpoints without automatic search', async () => {
    const operations = port();
    render(<ConversationToolsBrowser scopeKey="DEMO-A" profile="DEMO" port={operations} projects={[]} onOpen={() => undefined} onOrganize={() => undefined} />);
    await screen.findByText('合成会話');
    fireEvent.change(screen.getByLabelText('開始日'), { target: { value: '2026-10-07' } });
    fireEvent.change(screen.getByLabelText('終了日'), { target: { value: '2026-10-04' } });
    expect(screen.getByRole('alert')).toHaveTextContent('開始日は終了日以前');
    expect(screen.getByRole('button', { name: '条件を指定して取得' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: '条件を指定して取得' }));
    expect(operations.list).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: '開始日をクリア' }));
    expect(screen.getByLabelText('開始日')).toHaveValue(''); expect(screen.queryByRole('alert')).toBeNull();
    expect(operations.list).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: '条件を指定して取得' }));
    await waitFor(() => expect(operations.list).toHaveBeenLastCalledWith({ query: '', archive: 'active', to_time: new Date('2026-10-04T23:59:59.999').getTime() / 1000 }));
  });

  it('checks native invalid input and unsupported years instead of sending a malformed or widened query', async () => {
    const operations = port();
    render(<ConversationToolsBrowser scopeKey="DEMO-A" profile="DEMO" port={operations} projects={[]} onOpen={() => undefined} onOrganize={() => undefined} />);
    await screen.findByText('合成会話');
    const from = screen.getByLabelText('開始日');
    fireEvent.change(from, { target: { value: '10000-01-01' } });
    expect(screen.getByRole('alert')).toHaveTextContent('有効な日付');
    expect(screen.getByRole('button', { name: '条件を指定して取得' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: '開始日をクリア' }));
    Object.defineProperty(from, 'validity', { configurable: true, value: { badInput: true } });
    fireEvent.change(from, { target: { value: '2026-10-04' } });
    expect(screen.getByRole('alert')).toHaveTextContent('有効な日付');
    expect(operations.list).toHaveBeenCalledTimes(1);
  });

  it('resets filters locally and requires an explicit fetch before changing the displayed search scope', async () => {
    const operations = port();
    render(<ConversationToolsBrowser scopeKey="DEMO-A" profile="DEMO" port={operations} projects={[{ id: 'DEMO-project', name: 'DEMO project' }]}
      onOpen={() => undefined} onOrganize={() => undefined} />);
    await screen.findByText('合成会話');
    fireEvent.change(screen.getByLabelText('タイトル'), { target: { value: '日本語.*_100%' } });
    fireEvent.change(screen.getByLabelText('開始日'), { target: { value: '2026-10-04' } });
    fireEvent.change(screen.getByLabelText('project'), { target: { value: 'DEMO-project' } });
    fireEvent.change(screen.getByLabelText('表示'), { target: { value: 'archived' } });
    expect(screen.getByRole('button', { name: '次の50件を取得' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: '検索条件をクリア' }));
    expect(screen.getByLabelText('タイトル')).toHaveValue(''); expect(screen.getByLabelText('開始日')).toHaveValue('');
    expect(screen.getByLabelText('project')).toHaveValue(''); expect(screen.getByLabelText('表示')).toHaveValue('active');
    expect(operations.list).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: '条件を指定して取得' }));
    await waitFor(() => expect(operations.list).toHaveBeenLastCalledWith({ query: '', archive: 'active' }));
  });

  it('cancels only response application, keeps previous rows, and rejects a late result without a retry', async () => {
    const operations = port(); let finish!: (value: ConversationPage) => void;
    vi.mocked(operations.list).mockResolvedValueOnce(page).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    render(<ConversationToolsBrowser scopeKey="DEMO-A" profile="DEMO" port={operations} projects={[]} onOpen={() => undefined} onOrganize={() => undefined} />);
    await screen.findByText('合成会話');
    fireEvent.change(screen.getByLabelText('タイトル'), { target: { value: 'DEMO target' } });
    fireEvent.click(screen.getByRole('button', { name: '条件を指定して取得' }));
    expect(screen.getByText('取得中…')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '条件を指定して取得' }));
    expect(operations.list).toHaveBeenCalledTimes(2);
    fireEvent.change(screen.getByLabelText('タイトル'), { target: { value: 'DEMO edited during read' } });
    expect(operations.list).toHaveBeenLastCalledWith({ query: 'DEMO target', archive: 'active' });
    fireEvent.click(screen.getByRole('button', { name: '取得を取り消す' }));
    expect(screen.getByRole('status')).toHaveTextContent('表示への反映を取り消しました');
    await act(async () => finish({ ...page, sessions: [{ ...session, started_at: 1, parent_session_id: null, title: 'DEMO late result' }] }));
    expect(screen.queryByText('DEMO late result')).toBeNull(); expect(screen.getByText('合成会話')).toBeInTheDocument();
    expect(screen.getByLabelText('タイトル')).toHaveValue('DEMO edited during read');
    expect(operations.list).toHaveBeenCalledTimes(2); expect(operations.branch).not.toHaveBeenCalled();
  });

  it('does not claim an empty server history when the first fetch was cancelled', async () => {
    const operations = port(); let finish!: (value: ConversationPage) => void;
    vi.mocked(operations.list).mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    render(<ConversationToolsBrowser scopeKey="DEMO-A" profile="DEMO" port={operations} projects={[]} onOpen={() => undefined} onOrganize={() => undefined} />);
    fireEvent.click(screen.getByRole('button', { name: '取得を取り消す' }));
    expect(screen.getByText(/この範囲はまだ取得できていません/)).toBeInTheDocument();
    expect(screen.queryByText('この取得範囲の会話はありません。')).toBeNull();
    await act(async () => finish(page));
    expect(screen.queryByText('合成会話')).toBeNull(); expect(operations.list).toHaveBeenCalledTimes(1);
  });

  it('does not submit during Japanese IME confirmation and leaves composition edits in memory', async () => {
    const operations = port(), storage = vi.spyOn(Storage.prototype, 'setItem');
    const view = render(<ConversationToolsBrowser scopeKey="DEMO-A" profile="DEMO" port={operations} projects={[]} onOpen={() => undefined} onOrganize={() => undefined} />);
    await screen.findByText('合成会話'); const input = screen.getByLabelText('タイトル');
    fireEvent.compositionStart(input); fireEvent.change(input, { target: { value: '日本語の検索' } });
    const event = new KeyboardEvent('keydown', { key: 'Enter', isComposing: true, bubbles: true, cancelable: true });
    fireEvent(input, event); expect(event.defaultPrevented).toBe(true);
    fireEvent.submit(view.container.querySelector('form')!);
    expect(operations.list).toHaveBeenCalledTimes(1);
    fireEvent.compositionEnd(input);
    expect(screen.getByLabelText('タイトル')).toHaveValue('日本語の検索'); expect(storage).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '条件を指定して取得' }));
    await waitFor(() => expect(operations.list).toHaveBeenCalledTimes(2));
  });
  it('requires fresh metadata and performs only the selected organize action', async () => {
    const operations = port(); const changed = vi.fn();
    render(<ConversationToolsOrganization scopeKey="DEMO-A" port={operations} session={session} onChanged={changed} onDismiss={() => undefined} />);
    await waitFor(() => expect(screen.getByRole('button', { name: 'ピン留め' })).toBeEnabled());
    fireEvent.click(screen.getByRole('button', { name: 'ピン留め' }));
    await waitFor(() => expect(changed).toHaveBeenCalled());
    expect(operations.organize).toHaveBeenCalledWith(session, { pinned: true });
    expect(operations.branch).not.toHaveBeenCalled();
  });
  it('keeps organization dismissal separate from the keyboard-scrollable content', async () => {
    const operations = port(); const dismiss = vi.fn();
    render(<ConversationToolsOrganization scopeKey="DEMO-A" port={operations} session={session} onChanged={() => undefined} onDismiss={dismiss} />);
    const dialog = screen.getByRole('dialog', { name: '会話の整理' });
    const body = within(dialog).getByRole('region', { name: '会話の整理の内容' });
    expect(body).toHaveAttribute('tabindex', '0');
    expect(body).toContainElement(screen.getByLabelText('会話名'));
    expect(body).toContainElement(screen.getByRole('button', { name: '名前を保存' }));
    const close = within(dialog).getByRole('button', { name: '閉じる' });
    expect(close.closest('footer')).toHaveClass('remote-tools-dialog-footer');
    expect(body).not.toContainElement(close);
    expect(close).toHaveAttribute('data-dialog-initial-focus'); expect(close).toHaveFocus();
    expect(within(dialog).getByRole('heading', { name: '会話の整理' }).closest('header')).toHaveClass('remote-tools-dialog-header');
    await waitFor(() => expect(operations.metadata).toHaveBeenCalledTimes(1));
    fireEvent.keyDown(body, { key: 'End' }); fireEvent.click(close);
    expect(dismiss).toHaveBeenCalledTimes(1);
    expect(operations.organize).not.toHaveBeenCalled(); expect(operations.branch).not.toHaveBeenCalled();
  });
  it('retains an uncertain organization result and edited name while Close and Esc wait for the explicit operation', async () => {
    const operations = port(); const changed = vi.fn(); const dismiss = vi.fn();
    let reject!: (error: Error) => void;
    vi.mocked(operations.organize).mockImplementation(() => new Promise((_, fail) => { reject = fail; }));
    render(<ConversationToolsOrganization scopeKey="DEMO-A" port={operations} session={session} onChanged={changed} onDismiss={dismiss} />);
    await waitFor(() => expect(screen.getByRole('button', { name: '名前を保存' })).toBeEnabled());
    fireEvent.change(screen.getByLabelText('会話名'), { target: { value: 'DEMO 保持する会話名' } });
    fireEvent.click(screen.getByRole('button', { name: '名前を保存' }));
    const dialog = screen.getByRole('dialog', { name: '会話の整理' });
    expect(screen.getByRole('button', { name: '閉じる' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: '閉じる' }));
    fireEvent(dialog, new Event('cancel', { cancelable: true }));
    expect(dismiss).not.toHaveBeenCalled();
    await act(async () => reject(new Error('DEMO 変更結果不明・自動再実行しません')));
    expect(screen.getByRole('alert')).toHaveTextContent('変更結果不明');
    expect(screen.getByLabelText('会話名')).toHaveValue('DEMO 保持する会話名');
    expect(screen.getByRole('button', { name: '名前を保存' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '閉じる' })).toBeEnabled();
    expect(changed).not.toHaveBeenCalled(); expect(operations.organize).toHaveBeenCalledTimes(1);
    fireEvent(dialog, new Event('cancel', { cancelable: true })); expect(dismiss).toHaveBeenCalledTimes(1);
    expect(operations.organize).toHaveBeenCalledTimes(1); expect(operations.branch).not.toHaveBeenCalled();
  });
  it('inserts a user template only into the existing draft callback and keeps storage untouched', async () => {
    const operations = port(); const insert = vi.fn(); const storage = vi.spyOn(Storage.prototype, 'setItem');
    render(<ConversationToolsTemplates scopeKey="DEMO-A" port={operations} onInsert={insert} />);
    await screen.findByText(item.name);
    fireEvent.click(screen.getByRole('button', { name: '下書きへ挿入' }));
    expect(insert).toHaveBeenCalledWith(item.body);
    expect(operations.putTemplate).not.toHaveBeenCalled(); expect(operations.branch).not.toHaveBeenCalled(); expect(storage).not.toHaveBeenCalled();
  });
  it('creates a template on explicit save and verifies updated list', async () => {
    const operations = port(); render(<ConversationToolsTemplates scopeKey="DEMO-A" port={operations} onInsert={() => undefined} />);
    await screen.findByText(item.name); fireEvent.change(screen.getByLabelText('名前'), { target: { value: '日本語' } });
    fireEvent.change(screen.getByLabelText('本文'), { target: { value: '合成\n本文' } });
    fireEvent.click(screen.getByRole('button', { name: '定型文を保存' }));
    await waitFor(() => expect(operations.putTemplate).toHaveBeenCalledWith({ name: '日本語', category: '', body: '合成\n本文' }));
    await waitFor(() => expect(operations.templates).toHaveBeenCalledTimes(2));
  });
  it('asks before template removal and cancel sends no write', async () => {
    const operations = port(); render(<ConversationToolsTemplates scopeKey="DEMO-A" port={operations} onInsert={() => undefined} />);
    await screen.findByText(item.name); fireEvent.click(screen.getByRole('button', { name: `${item.name}を削除` }));
    expect(screen.getByRole('button', { name: '取消' })).toHaveFocus();
    expect(operations.removeTemplate).not.toHaveBeenCalled(); fireEvent.click(screen.getByRole('button', { name: '取消' }));
    expect(operations.removeTemplate).not.toHaveBeenCalled();
  });
  it('branch confirmation never submits or automatically generates and protects existing draft', async () => {
    const operations = port(); const created = vi.fn();
    const props = { scopeKey: 'DEMO-A', port: operations, sessionId: session.session_id, rowId: 2,
      mode: 'regenerate' as const, sourcePreview: '合成の回答', onCreated: created, onDismiss: () => undefined };
    const view = render(<ConversationToolsBranchDialog {...props} hasDraft />);
    expect(screen.getByRole('button', { name: '取消' })).toHaveFocus();
    expect(screen.getByRole('button', { name: '分岐を作成して下書きを開く' })).toBeDisabled(); expect(operations.branch).not.toHaveBeenCalled();
    view.rerender(<ConversationToolsBranchDialog {...props} />);
    fireEvent.click(screen.getByRole('button', { name: '分岐を作成して下書きを開く' }));
    await waitFor(() => expect(created).toHaveBeenCalled());
    expect(operations.branch).toHaveBeenCalledWith(session.session_id, 2, 'regenerate');
    expect(operations.organize).not.toHaveBeenCalled();
  });
  it('keeps branch cancellation outside the scrollable preview without sending a write', () => {
    const operations = port(); const dismiss = vi.fn();
    render(<ConversationToolsBranchDialog scopeKey="DEMO-A" port={operations} sessionId={session.session_id} rowId={2}
      mode="branch" sourcePreview={'DEMO 長い本文\n'.repeat(150)} onCreated={() => undefined} onDismiss={dismiss} />);
    const dialog = screen.getByRole('dialog', { name: '元の会話を残して分岐' });
    const body = within(dialog).getByRole('region', { name: '分岐内容の確認' });
    expect(body).toHaveAttribute('tabindex', '0');
    expect(body).toContainElement(screen.getByRole('button', { name: '分岐を作成して下書きを開く' }));
    expect(body.querySelector('blockquote')).toHaveTextContent('DEMO 長い本文');
    const cancel = within(dialog).getByRole('button', { name: '取消' });
    expect(cancel.closest('footer')).toHaveClass('remote-tools-dialog-footer');
    expect(body).not.toContainElement(cancel); expect(cancel).toHaveFocus();
    expect(within(dialog).getByRole('heading').closest('header')).toHaveClass('remote-tools-dialog-header');
    fireEvent.keyDown(body, { key: 'End' }); fireEvent.click(cancel);
    expect(dismiss).toHaveBeenCalledTimes(1); expect(operations.branch).not.toHaveBeenCalled();
    expect(operations.organize).not.toHaveBeenCalled(); expect(operations.metadata).not.toHaveBeenCalled();
  });
  it('holds branch cancellation while pending and never turns an unknown result into creation or a retry', async () => {
    const operations = port(); const created = vi.fn(); const dismiss = vi.fn();
    let reject!: (error: Error) => void;
    vi.mocked(operations.branch).mockImplementation(() => new Promise((_, fail) => { reject = fail; }));
    render(<ConversationToolsBranchDialog scopeKey="DEMO-A" port={operations} sessionId={session.session_id} rowId={2}
      mode="edit" sourcePreview="DEMO 原本文を保つ" onCreated={created} onDismiss={dismiss} />);
    fireEvent.click(screen.getByRole('button', { name: '分岐を作成して下書きを開く' }));
    const dialog = screen.getByRole('dialog', { name: '元の会話を残して分岐' });
    expect(screen.getByRole('button', { name: '取消' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: '取消' }));
    fireEvent(dialog, new Event('cancel', { cancelable: true })); expect(dismiss).not.toHaveBeenCalled();
    await act(async () => reject(new Error('DEMO 分岐結果不明・自動再実行しません')));
    expect(screen.getByRole('alert')).toHaveTextContent('分岐結果不明');
    expect(screen.getByRole('button', { name: '取消' })).toBeEnabled();
    expect(screen.getByText('DEMO 原本文を保つ')).toBeInTheDocument();
    expect(created).not.toHaveBeenCalled(); expect(operations.branch).toHaveBeenCalledTimes(1);
    fireEvent(dialog, new Event('cancel', { cancelable: true })); expect(dismiss).toHaveBeenCalledTimes(1);
    expect(operations.branch).toHaveBeenCalledTimes(1); expect(operations.organize).not.toHaveBeenCalled();
  });
});
