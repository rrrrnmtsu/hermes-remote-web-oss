import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { InformationController, type InformationPort } from '../../../core/src/features/information';
import { InformationPanel } from './InformationPanel';

beforeEach(() => {
  Object.defineProperty(HTMLDialogElement.prototype, 'showModal', { value: function(this: HTMLDialogElement) { this.open = true; }, configurable: true });
  Object.defineProperty(HTMLDialogElement.prototype, 'close', { value: function(this: HTMLDialogElement) { this.open = false; }, configurable: true });
});
afterEach(() => { cleanup(); vi.useRealTimers(); });
function props() {
  const port: InformationPort = { request: vi.fn(), canChangeModel: () => true, canCreateSession: () => true, withOperationLock: async action => action() };
  const controller = new InformationController(port);
  controller.setScope({ origin: 'https://DEMO.invalid', principal: 'DEMO-user', profile: 'DEMO-profile', liveId: 'DEMO-live', durableId: 'DEMO-durable', generation: '1' });
  return { state: controller.store.getState(), onLoad: vi.fn(), onModel: vi.fn(), onInsert: vi.fn(), onOpenSession: vi.fn(), onClose: vi.fn() };
}
function modelProps() {
  const options = props(); options.state.load.models = 'ready';
  options.state.models = { version: 1, profile: 'DEMO-profile', session_id: 'DEMO-live', model: 'first', provider: 'DEMO', api_mode: 'native', endpoint_origin: null, revision: '1', scope: 'configured_same_route', truncated: false,
    rows: ['first', 'next', '日本語候補'].map(model => ({ model, provider: 'DEMO', current: model === 'first', listed: true, credential_present: null, response_confirmed: null, selectable: true, reason: '' })) };
  return options;
}

describe('information view', () => {
  it('loads on explicit opening and stable renders do not create a read loop', () => {
    const options = props(); const { rerender } = render(<InformationPanel {...options} />);
    expect(options.onLoad).toHaveBeenCalledTimes(1); rerender(<InformationPanel {...options} onLoad={vi.fn()} />);
    expect(options.onLoad).toHaveBeenCalledTimes(1);
  });
  it('shows unknown availability/fee rather than falsely reporting success or zero', () => {
    const options = props(); options.state.agent = { version: 1, profile: 'DEMO-profile', session_id: 'DEMO-live', model: 'listed-only', provider: 'DEMO', api_mode: 'native',
      tools: [], tools_state: 'unknown', skills: [], skills_state: 'available', mcp: [], mcp_state: 'configured', usage: { source: 'unknown', actual_cost_usd: null, estimated_cost_usd: null }, observed_at: 1, truncated: false };
    render(<InformationPanel {...options} />); fireEvent.click(screen.getByRole('button', { name: '情報・利用量' }));
    expect(screen.getByText('利用量をまだ確認できていません')).toBeInTheDocument();
    expect(screen.getByText('未取得・状態不明')).toBeInTheDocument();
    expect(screen.getByText(/0円と扱いません/)).toBeInTheDocument();
  });
  it('Skill insert preserves explicit draft callback without performing a command', () => {
    const options = props(); options.state.load.commands = 'ready'; options.state.commands = { version: 1, profile: 'DEMO-profile', skills_state: 'available', truncated: false,
      rows: [{ text: '/DEMO-skill', description: '<script>synthetic</script>', category: 'Skills', kind: 'skill', support: 'draft', insertable: true },
        { text: '/model', description: 'management', category: 'Models', kind: 'command', support: 'management', insertable: false }] };
    const { container } = render(<InformationPanel {...options} />); fireEvent.click(screen.getByRole('button', { name: 'Skills' }));
    expect(screen.getAllByRole('button', { name: '下書きへ挿入' })).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: '下書きへ挿入' })); expect(options.onInsert).toHaveBeenCalledWith('/DEMO-skill ');
    expect(options.onModel).not.toHaveBeenCalled(); expect(container.querySelector('script')).toBeNull();
  });
  it('model selection alone performs no write until explicit application', () => {
    const options = props(); options.state.load.models = 'ready'; options.state.models = { version: 1, profile: 'DEMO-profile', session_id: 'DEMO-live', model: 'first', provider: 'DEMO', api_mode: 'native', endpoint_origin: null, revision: '1', scope: 'configured_same_route', truncated: false,
      rows: ['first', 'next'].map(model => ({ model, provider: 'DEMO', current: model === 'first', listed: true, credential_present: null, response_confirmed: null, selectable: true, reason: '' })) };
    render(<InformationPanel {...options} />); fireEvent.change(screen.getByLabelText('次に使うモデル'), { target: { value: 'next' } });
    expect(options.onModel).not.toHaveBeenCalled(); fireEvent.click(screen.getByRole('button', { name: 'この会話へ適用' }));
    expect(options.onModel.mock.calls).toEqual([['next']]);
    expect(screen.getAllByText(/資格情報: 未確認/)).toHaveLength(2);
  });
  it('filters only the in-memory catalog without a read or write, while keeping current and selected values available', () => {
    const options = modelProps(); render(<InformationPanel {...options} />);
    const model = screen.getByLabelText('次に使うモデル'), search = screen.getByLabelText('モデルを絞り込む');
    fireEvent.change(model, { target: { value: 'next' } });
    fireEvent.change(search, { target: { value: '日本語' } });
    expect(within(model).getAllByRole('option').map(row => row.getAttribute('value'))).toEqual(['first', 'next', '日本語候補']);
    expect(model).toHaveValue('next'); expect(screen.getByText('1件一致。現在・選択中のモデルは検索中も残します。')).toBeInTheDocument();
    fireEvent.change(search, { target: { value: 'DEMO absent' } });
    expect(within(model).getAllByRole('option').map(row => row.getAttribute('value'))).toEqual(['first', 'next']);
    expect(model).toHaveValue('next'); expect(screen.getByRole('button', { name: 'この会話へ適用' })).toBeEnabled();
    fireEvent.change(search, { target: { value: '' } }); expect(within(model).getAllByRole('option')).toHaveLength(3);
    expect(options.onLoad).toHaveBeenCalledTimes(1); expect(options.onModel).not.toHaveBeenCalled();
    expect(options.onInsert).not.toHaveBeenCalled();
  });
  it('names the model control independently of untrusted candidate names for VoiceOver and label lookup', () => {
    const options = modelProps(); options.state.models!.rows[2]!.model = 'DEMO <script> 次に使うモデル';
    render(<InformationPanel {...options} />);
    const model = screen.getByRole('combobox', { name: /^次に使うモデル$/ });
    expect(screen.getByLabelText('次に使うモデル', { exact: true })).toBe(model);
    expect(model).toHaveAccessibleName('次に使うモデル');
    expect(within(model).getByRole('option', { name: 'DEMO <script> 次に使うモデル' })).toBeInTheDocument();
    expect(options.onModel).not.toHaveBeenCalled();
  });
  it('keeps unknown credentials and unavailable-model reasons in initially collapsed details instead of asserting generation success', () => {
    const options = modelProps(); options.state.models!.rows[2] = { ...options.state.models!.rows[2]!, selectable: false, reason: 'limits_unknown' };
    render(<InformationPanel {...options} />);
    const details = screen.getByText('モデルの詳細（3件）').closest('details');
    expect(details).not.toHaveAttribute('open');
    expect(within(details!).getByText('このモデルの出力・文脈上限が未確認のため変更できません')).toBeInTheDocument();
    expect(within(details!).getAllByText(/資格情報: 未確認/)).toHaveLength(3);
    expect(within(screen.getByLabelText('次に使うモデル')).getByRole('option', { name: '日本語候補' })).toBeDisabled();
    fireEvent.change(screen.getByLabelText('次に使うモデル'), { target: { value: '日本語候補' } });
    const apply = screen.getByRole('button', { name: 'この会話へ適用' }); expect(apply).toBeDisabled(); fireEvent.click(apply);
    expect(options.onModel).not.toHaveBeenCalled();
  });
  it('requires a new explicit selection when an authoritative model revision changes', () => {
    const options = modelProps(); const view = render(<InformationPanel {...options} />);
    fireEvent.change(screen.getByLabelText('次に使うモデル'), { target: { value: 'next' } });
    expect(screen.getByRole('button', { name: 'この会話へ適用' })).toBeEnabled();
    view.rerender(<InformationPanel {...options} state={{ ...options.state, models: { ...options.state.models!, revision: 'DEMO-other-device-readback', model: '日本語候補',
      rows: options.state.models!.rows.map(row => ({ ...row, current: row.model === '日本語候補' })) } }} />);
    expect(screen.getByLabelText('次に使うモデル')).toHaveValue('日本語候補');
    expect(screen.getByRole('button', { name: 'この会話へ適用' })).toBeDisabled(); expect(options.onModel).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText('次に使うモデル'), { target: { value: 'next' } });
    fireEvent.click(screen.getByRole('button', { name: 'この会話へ適用' })); expect(options.onModel).toHaveBeenCalledOnce();
    expect(options.onModel).toHaveBeenCalledWith('next');
  });
  it('bounds search input and resets presentation choices when the session scope changes', () => {
    const options = modelProps(); const view = render(<InformationPanel {...options} />);
    fireEvent.change(screen.getByLabelText('モデルを絞り込む'), { target: { value: 'a'.repeat(201) } });
    expect(screen.getByLabelText('モデルを絞り込む')).toHaveValue('a'.repeat(200));
    fireEvent.change(screen.getByLabelText('次に使うモデル'), { target: { value: 'next' } });
    view.rerender(<InformationPanel {...options} state={{ ...options.state, scope: { ...options.state.scope!, liveId: 'DEMO-other-live', durableId: 'DEMO-other-durable', generation: '2' } }} />);
    expect(screen.getByLabelText('モデルを絞り込む')).toHaveValue('');
    expect(screen.getByLabelText('次に使うモデル')).toHaveValue('first'); expect(screen.getByRole('button', { name: 'この会話へ適用' })).toBeDisabled();
    expect(options.onModel).not.toHaveBeenCalled();
  });
  it('clearing a debounced catalog query restores the bounded unfiltered read', () => {
    vi.useFakeTimers(); const options = props(); render(<InformationPanel {...options} />);
    fireEvent.click(screen.getByRole('button', { name: 'Skills' }));
    fireEvent.change(screen.getByLabelText('取得したcatalogを検索'), { target: { value: '日本語' } });
    vi.advanceTimersByTime(250); expect(options.onLoad).toHaveBeenLastCalledWith('commands', '日本語');
    fireEvent.change(screen.getByLabelText('取得したcatalogを検索'), { target: { value: '' } });
    vi.advanceTimersByTime(250); expect(options.onLoad).toHaveBeenLastCalledWith('commands', '');
    expect(options.onInsert).not.toHaveBeenCalled(); expect(options.onModel).not.toHaveBeenCalled();
  });
  it('cron states preserve source timezone/JST and offer no job writes', () => {
    const options = props(); options.state.cron = { version: 1, profile: 'DEMO-profile', state: 'available', history_state: 'unavailable', truncated: false,
      jobs: [{ id: 'DEMO', name: 'DEMO-job', schedule: '0 9 * * *', timezone: 'America/New_York', enabled: true, next_run_at: '2026-10-05T09:00:00-04:00', next_run_jst: '2026-10-05T22:00:00+09:00', last_run_at: null, last_run_jst: null, last_status: null }], history: [] };
    render(<InformationPanel {...options} />); fireEvent.click(screen.getByRole('button', { name: '予定・履歴' }));
    expect(screen.getByText(/America\/New_York/)).toBeInTheDocument(); expect(screen.getByText(/次回（JST）/)).toBeInTheDocument();
    expect(screen.getByText('履歴ストアを確認できません。')).toBeInTheDocument(); expect(screen.queryByRole('button', { name: /即時実行|ジョブ作成|ジョブ変更/ })).toBeNull();
  });
  it('opening activity performs a bounded read and only explicit conversation opening navigates', () => {
    const options = props(); options.state.load.activity = 'ready'; options.state.activity = { version: 1, profile: 'DEMO-profile', observed_at: 1, truncated: false,
      rows: [{ durable_id: 'DEMO-durable', live_id: 'DEMO-live', title: 'DEMO会話', state: 'waiting_input', open_request_count: 1, last_active: 1 }] };
    render(<InformationPanel {...options} />); fireEvent.click(screen.getByRole('button', { name: '実行状況' }));
    expect(options.onOpenSession).not.toHaveBeenCalled(); fireEvent.click(screen.getByRole('button', { name: 'この会話を開く' }));
    expect(options.onOpenSession).toHaveBeenCalledWith('DEMO-durable'); expect(options.onModel).not.toHaveBeenCalled();
  });
  it('explains the existing local model guard instead of offering a silent no-op', () => {
    const options = props(); options.state.load.models = 'ready'; options.state.models = { version: 1, profile: 'DEMO-profile', session_id: 'DEMO-live', model: 'first', provider: 'DEMO', api_mode: 'native', endpoint_origin: null, revision: '1', scope: 'configured_same_route', truncated: false,
      rows: ['first', 'next'].map(model => ({ model, provider: 'DEMO', current: model === 'first', listed: true, credential_present: null, response_confirmed: null, selectable: true, reason: '' })) };
    render(<InformationPanel {...options} canChangeModel={false} />);
    fireEvent.change(screen.getByLabelText('次に使うモデル'), { target: { value: 'next' } });
    expect(screen.getByRole('button', { name: 'この会話へ適用' })).toBeDisabled();
    expect(screen.getByText(/入力内容は保持しています/)).toBeInTheDocument();
    expect(options.onModel).not.toHaveBeenCalled();
  });
  it('keeps an old model snapshot visible but blocks applying it after a failed read until the normal read succeeds', () => {
    const options = props(); options.state.load.models = 'ready'; options.state.models = { version: 1, profile: 'DEMO-profile', session_id: 'DEMO-live', model: 'first', provider: 'DEMO', api_mode: 'native', endpoint_origin: null, revision: '1', scope: 'configured_same_route', truncated: false,
      rows: ['first', 'next'].map(model => ({ model, provider: 'DEMO', current: model === 'first', listed: true, credential_present: null, response_confirmed: null, selectable: true, reason: '' })) };
    const view = render(<InformationPanel {...options} />); fireEvent.change(screen.getByLabelText('次に使うモデル'), { target: { value: 'next' } });
    view.rerender(<InformationPanel {...options} state={{ ...options.state, error: 'DEMO read failed', load: { ...options.state.load, models: 'error' } }} />);
    expect(screen.getByLabelText('次に使うモデル')).toBeDisabled(); const apply = screen.getByRole('button', { name: 'この会話へ適用' });
    expect(apply).toBeDisabled(); fireEvent.click(apply); expect(options.onModel).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toHaveTextContent('DEMO read failed');
    fireEvent.click(screen.getByRole('button', { name: '現在の情報を再取得' })); expect(options.onLoad).toHaveBeenLastCalledWith('models', '');
    view.rerender(<InformationPanel {...options} />); expect(apply).toBeEnabled(); expect(options.onModel).not.toHaveBeenCalled();
  });
  it('keeps Close and Escape blocked only while the model operation is pending', () => {
    const options = props(); const view = render(<InformationPanel {...options} state={{ ...options.state, writing: true }} />);
    const dialog = screen.getByRole('dialog', { name: '会話の情報' });
    expect(screen.getByRole('button', { name: '閉じる' })).toBeDisabled();
    fireEvent(dialog, new Event('cancel', { cancelable: true })); expect(options.onClose).not.toHaveBeenCalled();
    view.rerender(<InformationPanel {...options} state={{ ...options.state, writing: false, load: { ...options.state.load, models: 'loading' } }} />);
    expect(screen.getByRole('button', { name: '閉じる' })).toBeEnabled();
    expect(screen.getByRole('button', { name: '現在の情報を再取得' })).toBeDisabled();
    fireEvent(dialog, new Event('cancel', { cancelable: true })); expect(options.onClose).toHaveBeenCalledOnce();
  });
  it('uses arrows/Home/End for button focus without executing a read or write until explicit activation', () => {
    const options = props(); render(<InformationPanel {...options} />);
    const models = screen.getByRole('button', { name: 'モデル' }), activity = screen.getByRole('button', { name: '実行状況' });
    models.focus(); fireEvent.keyDown(models, { key: 'End' }); expect(activity).toHaveFocus();
    expect(options.onLoad).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(activity, { key: 'Home' }); expect(models).toHaveFocus();
    fireEvent.keyDown(models, { key: 'ArrowRight' }); expect(screen.getByRole('button', { name: '情報・利用量' })).toHaveFocus();
    expect(options.onModel).not.toHaveBeenCalled(); expect(options.onInsert).not.toHaveBeenCalled();
  });
  it('keeps a separate reading position per information type and resets it for another scope', () => {
    const options = props(); const view = render(<InformationPanel {...options} />);
    const body = screen.getByRole('region', { name: '会話の情報の内容' });
    body.scrollTop = 240; fireEvent.scroll(body);
    fireEvent.click(screen.getByRole('button', { name: '情報・利用量' })); expect(body.scrollTop).toBe(0);
    body.scrollTop = 90; fireEvent.scroll(body);
    fireEvent.click(screen.getByRole('button', { name: 'モデル' })); expect(body.scrollTop).toBe(240);
    view.rerender(<InformationPanel {...options} state={{ ...options.state, scope: { ...options.state.scope!, profile: 'DEMO-other', generation: '2' } }} />);
    expect(body.scrollTop).toBe(0); expect(options.onModel).not.toHaveBeenCalled();
  });
});
