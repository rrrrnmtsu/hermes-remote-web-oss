import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { projectBotStatus, type BotOverviewState } from '../../../core/src/features/bots';
import { BotOverviewPanel } from './BotOverviewPanel';

beforeEach(() => {
  Object.defineProperty(HTMLDialogElement.prototype, 'showModal', { value: function(this: HTMLDialogElement) { this.open = true; }, configurable: true });
  Object.defineProperty(HTMLDialogElement.prototype, 'close', { value: function(this: HTMLDialogElement) { this.open = false; }, configurable: true });
});
afterEach(cleanup);
function props() {
  const snapshot = projectBotStatus({ gateway_running: true, gateway_state: 'running', gateway_platforms: {
    discord: { state: 'connected' }, telegram: { state: 'disconnected' }, slack: { state: 'disabled' }, unknown_plugin: {},
  }, gateway_heartbeat_stale_s: 100, gateway_shared_with: ['DEMO-profile', 'other'] }, 'DEMO-profile', 10)!;
  const state: BotOverviewState = { scope: { origin: 'https://demo.invalid', profile: 'DEMO-profile', principal: 'DEMO-owner', generation: '1' },
    load: 'ready', snapshot, error: '' };
  const sessions = [{ durableId: 'DEMO-discord', lineageId: 'DEMO-discord', title: 'DEMO <script> 日本語会話', source: 'discord' },
    { durableId: 'DEMO-web', lineageId: 'DEMO-web', title: 'DEMO WEB', source: 'tui' }];
  return { state, sessions, canOpenSession: true, onLoad: vi.fn(), onOpenSession: vi.fn(), onClose: vi.fn() };
}

describe('bot overview is a bounded read-only view', () => {
  it('loads once on explicit opening, retains stable modal ownership and makes no read when filtering', () => {
    const options = props(); const view = render(<BotOverviewPanel {...options} />);
    expect(options.onLoad).toHaveBeenCalledTimes(1); view.rerender(<BotOverviewPanel {...options} onLoad={vi.fn()} />);
    fireEvent.change(screen.getByLabelText('ボットを絞り込む'), { target: { value: 'attention' } });
    expect(within(screen.getByRole('list', { name: 'ボット接続状態' })).queryByText('Discord')).toBeNull();
    expect(within(screen.getByRole('list', { name: 'ボット接続状態' })).queryByText('Slack')).toBeNull();
    expect(within(screen.getByRole('list', { name: 'ボット接続状態' })).getByText('Telegram')).toBeInTheDocument(); expect(screen.getByText('状態未確認')).toBeInTheDocument();
    expect(options.onLoad).toHaveBeenCalledTimes(1); expect(options.onOpenSession).not.toHaveBeenCalled();
  });
  it('distinguishes Web WSS, shared gateway, stale heartbeat and actual message delivery', () => {
    render(<BotOverviewPanel {...props()} />);
    expect(screen.getByText(/WSS接続と/)).toBeInTheDocument(); expect(screen.getByText(/複数profileで共有/)).toBeInTheDocument();
    expect(screen.getByText(/状態更新が遅れています/)).toBeInTheDocument(); expect(screen.getByText(/実際の送受信成功を保証しません/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /起動|停止|テスト送信|設定を保存/ })).toBeNull();
  });
  it('shows only already-loaded source-matching conversations, escaping titles and navigating solely on an explicit click', () => {
    const options = props(); const { container } = render(<BotOverviewPanel {...options} />);
    expect(screen.queryByText('DEMO WEB')).toBeNull(); expect(container.querySelector('script')).toBeNull();
    expect(screen.getByText('DEMO <script> 日本語会話')).toBeInTheDocument(); expect(options.onOpenSession).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'この会話を開く' })); expect(options.onOpenSession).toHaveBeenCalledWith('DEMO-discord');
  });
  it('blocks duplicate refresh during loading and stale/error navigation while allowing close/Escape', () => {
    const options = props(); const view = render(<BotOverviewPanel {...options} state={{ ...options.state, load: 'loading' }} />);
    expect(screen.getByRole('button', { name: '状態を再取得' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'この会話を開く' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '閉じる' })).toBeEnabled();
    view.rerender(<BotOverviewPanel {...options} state={{ ...options.state, load: 'error', error: 'DEMO read failed' }} />);
    expect(screen.getByRole('alert')).toHaveTextContent('DEMO read failed'); expect(screen.getByText(/以前の取得結果を表示/)).toBeInTheDocument();
    fireEvent(screen.getByRole('dialog', { name: 'ボットの状態' }), new Event('cancel', { cancelable: true })); expect(options.onClose).toHaveBeenCalledTimes(1);
  });
  it('explains current draft/run guards instead of creating or resuming a conversation', () => {
    const options = props(); render(<BotOverviewPanel {...options} canOpenSession={false} />);
    const open = screen.getByRole('button', { name: 'この会話を開く' }); expect(open).toBeDisabled(); fireEvent.click(open);
    expect(options.onOpenSession).not.toHaveBeenCalled(); expect(screen.getByText(/現在の内容は保持/)).toBeInTheDocument();
  });
  it('keeps no-data/unsupported/truncated/missing-timestamp states explicit without asserting an empty configuration', () => {
    const options = props(); const snapshot = { ...options.state.snapshot!, platforms: [], truncated: true, updatedAt: null };
    const view = render(<BotOverviewPanel {...options} state={{ ...options.state, snapshot }} />);
    expect(screen.getByText(/設定済みボットがないとは断定しません/)).toBeInTheDocument(); expect(screen.getByText(/最大50件/)).toBeInTheDocument();
    expect(screen.getByText(/サーバーの状態更新: 未確認/)).toBeInTheDocument();
    view.rerender(<BotOverviewPanel {...options} state={{ ...options.state, snapshot: { ...snapshot, platformsAvailable: false } }} />);
    expect(screen.getByText(/この応答では取得できませんでした/)).toBeInTheDocument();
    view.rerender(<BotOverviewPanel {...options} state={{ ...options.state, load: 'unsupported', snapshot: null }} />);
    expect(screen.getByText(/接続済みとは判断しません/)).toBeInTheDocument();
    view.rerender(<BotOverviewPanel {...options} state={{ ...options.state, scope: null, snapshot: null }} />);
    expect(screen.getByText(/profileを選択すると/)).toBeInTheDocument(); expect(screen.getByRole('button', { name: '状態を再取得' })).toBeDisabled();
  });
});
