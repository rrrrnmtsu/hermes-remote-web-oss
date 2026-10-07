import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RemoteController, type RemoteState } from '../../../core/src/stores/remote';
import type { Http } from '../../../core/src/transport/http';
import type { RemoteDocument } from '../../../core/src/features/documents';
import { Conversation } from './Conversation';

const document: RemoteDocument = { name: 'DEMO.md', format: 'MARKDOWN', bytes: new TextEncoder().encode('DEMO 資料の本文'),
  preview: 'DEMO 資料の本文', previewTruncated: false, extraction: 'utf8', status: 'selected' };
function controller() {
  const http: Http = Object.assign(async <T,>() => ({} as T), { setProfile: () => undefined });
  const result = new RemoteController({ http, origin: 'https://demo.invalid', secure: true,
    makeGateway: () => { throw new Error('UI-only DEMO'); }, withOperationLock: async action => action() });
  result.store.setState({ connection: 'connected', generationAllowed: false, liveId: 'DEMO-live', durableId: 'DEMO-stored', profile: 'default',
    draft: 'DEMO 説明の下書き' });
  return result;
}
const conversation = (active: RemoteController, state: RemoteState = active.store.getState()) => <Conversation controller={active} state={state}
  onBack={() => undefined} onRequests={() => undefined} onSidebar={() => undefined} onComposerFocus={() => undefined} />;
const file = (text: string) => ({ name: 'DEMO.md', type: 'text/markdown', size: new TextEncoder().encode(text).length,
  arrayBuffer: async () => new TextEncoder().encode(text).buffer }) as File;
beforeEach(() => {
  Object.defineProperty(navigator, 'locks', { value: {}, configurable: true });
  Object.defineProperty(HTMLElement.prototype, 'scrollTo', { value: vi.fn(), configurable: true });
  Object.defineProperty(HTMLDialogElement.prototype, 'showModal', { value: function(this: HTMLDialogElement) { this.open = true; }, configurable: true });
  Object.defineProperty(HTMLDialogElement.prototype, 'close', { value: function(this: HTMLDialogElement) { this.open = false; }, configurable: true });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe('conversation attachment controls remain local and scoped', () => {
  it('opens the current document details directly and local cancel keeps the message draft', () => {
    const active = controller(); active.store.setState({ document });
    const submit = vi.spyOn(active, 'submit').mockResolvedValue(undefined);
    const view = render(conversation(active));
    fireEvent.click(screen.getByRole('button', { name: '資料の詳細と上限' }));
    const dialog = screen.getByRole('dialog', { name: '資料の詳細' });
    expect(screen.queryByRole('dialog', { name: '入力の補助' })).toBeNull();
    expect(within(dialog).getByLabelText('選択した資料の端末内プレビュー')).toHaveTextContent('DEMO 資料の本文');
    fireEvent.click(within(dialog).getByRole('button', { name: '添付を外す' }));
    view.rerender(conversation(active));
    expect(screen.queryByRole('dialog')).toBeNull(); expect(active.store.getState().document).toBeNull();
    expect(screen.getByLabelText('Hermesへのメッセージ')).toHaveValue('DEMO 説明の下書き'); expect(submit).not.toHaveBeenCalled();
  });

  it('refreshes the shown transfer status without permitting cancellation or resend after ACK loss', () => {
    const active = controller(); active.store.setState({ document });
    const submit = vi.spyOn(active, 'submit').mockResolvedValue(undefined);
    const view = render(conversation(active));
    fireEvent.click(screen.getByRole('button', { name: '資料の詳細と上限' }));
    act(() => active.store.setState({ document: { ...document, status: 'delivery_unknown' }, delivery: 'delivery_unknown', execution: 'unknown' }));
    view.rerender(conversation(active));
    const dialog = screen.getByRole('dialog', { name: '資料の詳細' });
    expect(within(dialog).getByRole('alert')).toHaveTextContent('自動再送しません');
    expect(within(dialog).queryByRole('button', { name: '添付を外す' })).toBeNull();
    fireEvent.click(within(dialog).getByRole('button', { name: '閉じる' }));
    expect(screen.getByRole('button', { name: '送信' })).toBeDisabled(); expect(submit).not.toHaveBeenCalled();
  });

  it.each(['scope', 'payload'] as const)('closes stale details after the %s changes and does not reopen them later', change => {
    const active = controller(); active.store.setState({ document });
    const view = render(conversation(active));
    fireEvent.click(screen.getByRole('button', { name: '資料の詳細と上限' }));
    act(() => active.store.setState(change === 'scope' ? { profile: 'DEMO-other', liveId: 'DEMO-other-live' }
      : { document: { ...document, bytes: document.bytes.slice(), name: 'DEMO-other.md' } }));
    view.rerender(conversation(active)); expect(screen.queryByRole('dialog')).toBeNull();
    act(() => active.store.setState({ profile: 'default', liveId: 'DEMO-live', document }));
    view.rerender(conversation(active)); expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('names a pending document read correctly and performs no implicit submit', async () => {
    const active = controller(), selected = file('DEMO 選択中の資料');
    let complete!: (bytes: ArrayBuffer) => void;
    vi.spyOn(selected, 'arrayBuffer').mockImplementation(() => new Promise(resolve => { complete = resolve; }));
    const submit = vi.spyOn(active, 'submit').mockResolvedValue(undefined);
    render(conversation(active));
    fireEvent.change(screen.getByLabelText('TXT・Markdown・CSV・PDFを1つ選択'), { target: { files: [selected] } });
    expect(screen.getByText('端末内で資料を確認中… 転送していません。')).toBeVisible();
    expect(screen.queryByText('端末内で画像を確認中… 転送していません。')).toBeNull();
    expect(screen.getByRole('button', { name: '送信' })).toBeDisabled();
    await act(async () => complete(new TextEncoder().encode('DEMO 選択中の資料').buffer));
    await waitFor(() => expect(active.store.getState().document?.status).toBe('selected'));
    expect(submit).not.toHaveBeenCalled();
  });

  it('labels rejected document content as a document error while retaining the draft', async () => {
    const active = controller(); render(conversation(active));
    fireEvent.change(screen.getByLabelText('TXT・Markdown・CSV・PDFを1つ選択'), { target: { files: [file('<html>DEMO spoof</html>')] } });
    expect(await screen.findByText('資料を追加できません')).toBeVisible();
    expect(screen.queryByText('画像を追加できません')).toBeNull();
    expect(screen.getByRole('alert')).toHaveTextContent('偽装した資料');
    expect(active.store.getState().document).toBeNull();
    expect(screen.getByLabelText('Hermesへのメッセージ')).toHaveValue('DEMO 説明の下書き');
  });
});
