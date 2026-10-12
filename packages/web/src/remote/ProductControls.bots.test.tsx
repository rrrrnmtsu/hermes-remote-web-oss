import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RemoteController } from '../../../core/src/stores/remote';
import type { Http } from '../../../core/src/transport/http';
import { ProductControls, type ProductSelection } from './ProductControls';

const controllers: RemoteController[] = [];
beforeEach(() => {
  Object.defineProperty(window.location, 'origin', { value: 'https://demo.invalid', configurable: true });
  Object.defineProperty(HTMLDialogElement.prototype, 'showModal', { value: function(this: HTMLDialogElement) { this.open = true; }, configurable: true });
  Object.defineProperty(HTMLDialogElement.prototype, 'close', { value: function(this: HTMLDialogElement) { this.open = false; }, configurable: true });
});
afterEach(() => { cleanup(); controllers.forEach(controller => controller.dispose()); controllers.length = 0; vi.restoreAllMocks(); });
function fixture() {
  const read = vi.fn().mockResolvedValue({}); const http = Object.assign(read, { setProfile: vi.fn() }) as Http;
  const controller = new RemoteController({ http, origin: 'https://demo.invalid', secure: true,
    makeGateway: () => { throw new Error('DEMO no transport in composition test'); }, withOperationLock: async action => action() });
  controllers.push(controller);
  controller.store.setState({ connection: 'connected', authenticated: true, readRpc: true, principalId: 'a'.repeat(64), profiles: ['default', 'other'],
    featureMethods: ['remote.sessions.list'], sessions: [] });
  const status = vi.spyOn(controller, 'readBotStatus').mockResolvedValue({ gateway_running: false, gateway_state: 'stopped', gateway_platforms: {} });
  const page = vi.spyOn(controller, 'readBotConversationPage').mockResolvedValue({ rows: [{ id: 'DEMO-canonical', title: 'DEMO-owned-title', source: 'discord',
    titleTruncated: false, startedAt: 10, pinned: false, archived: false }], nextCursor: null, snapshotTime: 30, sourceIndexSize: 1 });
  const write = vi.spyOn(controller, 'featureRequest').mockRejectedValue(new Error('DEMO no generic operation'));
  const options = { controller, state: controller.store.getState(), selection: null as ProductSelection | null, onSelection: vi.fn(), onOpen: vi.fn(),
    safeNavigate: true, safeUpdate: true, onInsert: vi.fn(), onSafetyChange: vi.fn(), onLogoutPreparation: vi.fn() };
  const view = render(<ProductControls {...options} />);
  view.rerender(<ProductControls {...options} selection={{ action: 'bots' }} />);
  return { controller, options, view, read, status, page, write };
}
async function load() { await screen.findByText('停止を報告'); fireEvent.click(screen.getByRole('button', { name: '会話一覧を取得' })); await screen.findByText('DEMO-owned-title'); }

describe('bot composition owns one scope and preserves existing operation guards', () => {
  it('loads only through the central explicit port and keeps pages across equivalent capability-array rerenders', async () => {
    const { controller, options, view, page, write, read } = fixture();
    await screen.findByText('停止を報告'); expect(page).not.toHaveBeenCalled(); await load();
    const original = controller.store.getState().sessions;
    controller.store.setState({ featureMethods: ['remote.sessions.list'] });
    view.rerender(<ProductControls {...options} state={controller.store.getState()} selection={{ action: 'bots' }} />);
    expect(screen.getByText('DEMO-owned-title')).toBeInTheDocument(); expect(page).toHaveBeenCalledOnce();
    expect(controller.store.getState().sessions).toBe(original); expect(write).not.toHaveBeenCalled(); expect(read).not.toHaveBeenCalled();
  });
  it('routes an explicit canonical row through the existing navigation callback once', async () => {
    const { options, page, write } = fixture(); await load();
    fireEvent.click(screen.getByRole('button', { name: 'この会話を開く' }));
    expect(options.onOpen).toHaveBeenCalledExactlyOnceWith('DEMO-canonical'); expect(options.onSelection).toHaveBeenLastCalledWith(null);
    expect(page).toHaveBeenCalledOnce(); expect(write).not.toHaveBeenCalled();
  });
  it.each(['draft', 'running', 'delivery_unknown', 'request'])('keeps the %s guard authoritative even if a stale visible button is enabled', async guard => {
    const { controller, options } = fixture(); await load();
    if (guard === 'draft') controller.setDraft('DEMO 元の下書き');
    else if (guard === 'running') controller.store.setState({ execution: 'running' });
    else if (guard === 'delivery_unknown') controller.store.setState({ delivery: 'delivery_unknown' });
    else controller.store.setState({ liveId: 'DEMO-live', requests: [{ key: 'number:1', id: 1, method: 'approval', profile: 'default', sessionId: 'DEMO-live', status: 'pending', params: {} }] });
    fireEvent.click(screen.getByRole('button', { name: 'この会話を開く' })); expect(options.onOpen).not.toHaveBeenCalled();
    if (guard === 'draft') expect(controller.store.getState().draft).toBe('DEMO 元の下書き');
  });
  it('rejects callbacks captured before a profile/project change rather than acting on the new scope', async () => {
    const { controller, options, page } = fixture(); await load();
    controller.store.setState({ profile: 'other' });
    fireEvent.click(screen.getByRole('button', { name: 'この会話を開く' }));
    fireEvent.click(screen.getByRole('button', { name: '会話一覧を最初から再取得' }));
    expect(options.onOpen).not.toHaveBeenCalled(); expect(page).toHaveBeenCalledOnce();
  });
  it('drops rows/search when project scope changes and uses only the new registered project', async () => {
    const { controller, options, view, page } = fixture(); await load();
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'DEMO' } });
    controller.store.setState({ selectedProjectId: 'DEMO-project', projects: [{ id: 'DEMO-project', label: 'DEMO 作業先', kind: 'registered', sessionCount: 0, sessionIds: [], previews: [], lastActive: null }] });
    view.rerender(<ProductControls {...options} state={controller.store.getState()} selection={{ action: 'bots' }} />);
    expect(screen.queryByText('DEMO-owned-title')).toBeNull(); expect(screen.getByRole('searchbox')).toHaveValue('');
    fireEvent.click(screen.getByRole('button', { name: '会話一覧を取得' })); await screen.findByText('DEMO-owned-title');
    expect(page.mock.calls.at(-1)?.[0].projectId).toBe('DEMO-project');
  });
  it('close discards pending reads and no late result restores a reopened list', async () => {
    const { options, view, page } = fixture(); let resolve!: (value: Awaited<ReturnType<RemoteController['readBotConversationPage']>>) => void;
    page.mockReturnValueOnce(new Promise(done => { resolve = done; })); await screen.findByText('停止を報告');
    fireEvent.click(screen.getByRole('button', { name: '会話一覧を取得' })); await waitFor(() => expect(page).toHaveBeenCalledOnce());
    fireEvent.click(screen.getByRole('button', { name: '閉じる' })); expect(page.mock.calls[0]?.[2].aborted).toBe(true);
    view.rerender(<ProductControls {...options} selection={null} />); view.rerender(<ProductControls {...options} selection={{ action: 'bots' }} />);
    resolve({ rows: [], nextCursor: null, snapshotTime: 30, sourceIndexSize: 0 }); await screen.findByText('停止を報告');
    expect(screen.getByRole('button', { name: '会話一覧を取得' })).toBeInTheDocument(); expect(page).toHaveBeenCalledOnce();
  });
});
