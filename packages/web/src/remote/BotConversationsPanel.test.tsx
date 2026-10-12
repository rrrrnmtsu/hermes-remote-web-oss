import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BotConversationsPanel, type BotConversationControls } from './BotConversationsPanel';
import { BotConversationsController, type BotConversation } from '../../../core/src/features/bot-conversations';

afterEach(cleanup);
const row = (id: string, source: string | null = 'discord', title = 'DEMO 日本語 [.*]'): BotConversation => ({
  id, source, title, titleTruncated: false, startedAt: 10, pinned: false, archived: false,
});
function controls(extra: Partial<BotConversationControls['state']> = {}): BotConversationControls {
  const state = new BotConversationsController({ readPage: vi.fn() }).store.getState();
  return { state: { ...state, available: true, scope: { origin: 'https://demo.invalid', principal: 'DEMO-owner', profile: 'DEMO-profile', generation: '1', projectId: '' }, ...extra },
    projectLabel: 'profile内の全作業先', onRead: vi.fn() };
}
const base = () => ({ platforms: [], seeds: [], canOpen: true, onOpen: vi.fn() });

describe('owned bot conversations use explicit reads and memory filters', () => {
  it('does not fetch on mount/filter/search, and first/next page actions remain distinct', () => {
    const options = base(), read = controls(); const view = render(<BotConversationsPanel {...options} controls={read} />);
    expect(read.onRead).not.toHaveBeenCalled(); fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'DEMO' } });
    expect(read.onRead).not.toHaveBeenCalled(); fireEvent.click(screen.getByRole('button', { name: '会話一覧を取得' }));
    expect(read.onRead).toHaveBeenCalledWith(false);
    view.rerender(<BotConversationsPanel {...options} controls={{ ...read, state: { ...read.state, rows: [row('one')], pages: 1, load: 'ready', nextCursor: 'DEMO-next' } }} />);
    fireEvent.click(screen.getByRole('button', { name: '次の50件を取得' })); expect(read.onRead).toHaveBeenLastCalledWith(true);
    expect(screen.getByText(/1回50件・最大4ページ/)).toBeInTheDocument();
  });
  it('filters only loaded bot titles literally and navigates only from the canonical row on an explicit click', () => {
    const options = base(), read = controls({ rows: [row('one'), row('two', 'telegram', 'DEMO 通常'), row('unknown', null), row('web', 'tui')], pages: 1, load: 'ready' });
    render(<BotConversationsPanel {...options} controls={read} />);
    expect(screen.getAllByRole('button', { name: 'この会話を開く' })).toHaveLength(2);
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: '[.*]' } });
    expect(screen.getAllByRole('button', { name: 'この会話を開く' })).toHaveLength(1); expect(read.onRead).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'この会話を開く' })); expect(options.onOpen).toHaveBeenCalledWith('one');
    fireEvent.change(screen.getByLabelText('会話のボットを選ぶ'), { target: { value: 'telegram' } });
    expect(screen.queryByRole('button', { name: 'この会話を開く' })).toBeNull(); fireEvent.click(screen.getByText('会話タイトル検索をクリア'));
    expect(screen.getByText('DEMO 通常')).toBeInTheDocument(); expect(read.onRead).not.toHaveBeenCalled();
    expect(screen.getByText(/1件のボット種別/)).toBeInTheDocument();
  });
  it('keeps unknown source/range/completion honest and escapes long or malicious titles without changing message content', () => {
    const read = controls({ rows: [{ ...row('one', 'discord', 'DEMO <script>秘密</script>'), titleTruncated: true, pinned: true }], pages: 4, load: 'ready', nextCursor: 'DEMO-more' });
    const { container } = render(<BotConversationsPanel {...base()} controls={read} />);
    expect(container.querySelector('script')).toBeNull(); expect(screen.getByText('DEMO <script>秘密</script>')).toBeInTheDocument();
    expect(screen.getByText(/長いタイトルを省略/)).toBeInTheDocument(); expect(screen.getByText(/最大4ページの取得上限/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '次の50件を取得' })).toBeDisabled(); expect(screen.getByText(/ピン留め/)).toBeInTheDocument();
  });
  it('blocks opening during a read, stale/error or an existing draft while preserving explicit refresh and close ownership', () => {
    const options = base(), read = controls({ rows: [row('one')], pages: 1, load: 'loading', nextCursor: 'DEMO-more' });
    const view = render(<BotConversationsPanel {...options} controls={read} />);
    expect(screen.getByRole('button', { name: 'この会話を開く' })).toBeDisabled(); expect(screen.getByRole('button', { name: '会話一覧を最初から再取得' })).toBeDisabled();
    view.rerender(<BotConversationsPanel {...options} controls={{ ...read, state: { ...read.state, load: 'error', stale: true, error: 'DEMO read error' } }} />);
    expect(screen.getByRole('alert')).toHaveTextContent('DEMO read error'); expect(screen.getByText(/以前の取得範囲/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'この会話を開く' })).toBeDisabled(); expect(screen.getByRole('button', { name: '会話一覧を最初から再取得' })).toBeEnabled();
    view.rerender(<BotConversationsPanel {...options} canOpen={false} controls={{ ...read, state: { ...read.state, load: 'ready' } }} />);
    fireEvent.click(screen.getByRole('button', { name: 'この会話を開く' })); expect(options.onOpen).not.toHaveBeenCalled();
    expect(screen.getByText(/現在の内容は保持/)).toBeInTheDocument();
  });
  it('clears a removed source option without a fetch and drops filters on a scope-keyed remount', () => {
    const read = controls({ rows: [row('one'), row('two', 'telegram')], pages: 1, load: 'ready' });
    const view = render(<BotConversationsPanel key="DEMO-one" {...base()} controls={read} />);
    fireEvent.change(screen.getByLabelText('会話のボットを選ぶ'), { target: { value: 'telegram' } });
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: '日本語' } });
    view.rerender(<BotConversationsPanel key="DEMO-one" {...base()} controls={{ ...read, state: { ...read.state, rows: [row('one')] } }} />);
    expect(screen.getByLabelText('会話のボットを選ぶ')).toHaveValue(''); expect(screen.getByRole('searchbox')).toHaveValue('日本語');
    view.rerender(<BotConversationsPanel key="DEMO-two" {...base()} controls={read} />);
    expect(screen.getByRole('searchbox')).toHaveValue(''); expect(read.onRead).not.toHaveBeenCalled();
  });
  it('provides loaded-source previews without pretending an older server supports owned pagination', () => {
    const read = controls({ available: false });
    render(<BotConversationsPanel {...base()} seeds={[{ durableId: 'DEMO-seed', lineageId: 'DEMO-seed', title: 'DEMO 取得済み', source: 'discord' }]} controls={read} />);
    expect(screen.getByText(/所有者付きの追加取得に未対応/)).toBeInTheDocument(); expect(screen.getByRole('button', { name: '会話一覧を取得' })).toBeDisabled();
    expect(within(screen.getByRole('region')).getByText('DEMO 取得済み')).toBeInTheDocument(); expect(screen.getByText(/読み込み済みの範囲だけ/)).toBeInTheDocument();
  });
  it('returns clear focus to the query and read focus to the safe dialog control before disabling buttons', () => {
    const read = controls();
    render(<dialog open><button data-dialog-initial-focus>DEMO close</button><BotConversationsPanel {...base()} controls={read} /></dialog>);
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'DEMO' } });
    const clear = screen.getByText('会話タイトル検索をクリア'); clear.focus(); fireEvent.click(clear);
    expect(screen.getByRole('searchbox')).toHaveFocus();
    const first = screen.getByRole('button', { name: '会話一覧を取得' }); first.focus(); fireEvent.click(first);
    expect(screen.getByRole('button', { name: 'DEMO close' })).toHaveFocus(); expect(read.onRead).toHaveBeenCalledOnce();
  });
});
