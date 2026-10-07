import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DocumentCapabilities, RemoteDocument } from '../../../core/src/features/documents';
import type { RemoteImage } from '../../../core/src/stores/image-transfer';
import { demoImage } from '../../../core/src/stores/image-fixtures.test-data';
import { AttachmentDetails } from './AttachmentDetails';

const doc: RemoteDocument = { name: '<script>DEMO.md', format: 'MARKDOWN', bytes: new TextEncoder().encode('DEMO 日本語の資料'),
  preview: '<img src=x onerror=alert(1)>\nDEMO 日本語の資料', previewTruncated: false, extraction: 'utf8', status: 'selected' };
const image: RemoteImage = { ...demoImage(), status: 'selected' };
const capabilities: DocumentCapabilities = { version: 1, enabled: false, reason: 'DEMO local only', formats: ['TXT', 'MARKDOWN', 'CSV', 'PDF'],
  max_raw_bytes: 32_000, max_frame_bytes: 8_388_608, max_text_bytes: 65_536, max_extracted_bytes: 16_384, max_pages: 3,
  model_input_max_bytes: 262_144, extraction: 'text_only', generation_verified: false };

beforeEach(() => {
  Object.defineProperty(HTMLDialogElement.prototype, 'showModal', { value: function(this: HTMLDialogElement) { this.open = true; }, configurable: true });
  Object.defineProperty(HTMLDialogElement.prototype, 'close', { value: function(this: HTMLDialogElement) { this.open = false; }, configurable: true });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('attachment details use the selected memory payload only', () => {
  it('renders literal document preview, focuses the safe close action and never transfers or saves', () => {
    const fetch = vi.fn(), websocket = vi.fn(), create = vi.fn();
    vi.stubGlobal('fetch', fetch); vi.stubGlobal('WebSocket', websocket);
    vi.stubGlobal('URL', { createObjectURL: create, revokeObjectURL: vi.fn() });
    const persist = vi.spyOn(Storage.prototype, 'setItem');
    const cancel = vi.fn(), dismiss = vi.fn();
    const view = render(<AttachmentDetails kind="document" document={doc} capabilities={null} rawLimit={32_000} localOnly
      onCancel={cancel} onDismiss={dismiss} />);
    const dialog = screen.getByRole('dialog', { name: '資料の詳細' });
    expect(within(dialog).getByRole('button', { name: '閉じる' })).toHaveFocus();
    expect(within(dialog).getByLabelText('選択した資料の端末内プレビュー').textContent).toBe(doc.preview);
    expect(view.container.querySelector('img, script, iframe')).toBeNull();
    expect(within(dialog).getByRole('status')).toHaveTextContent('端末内プレビューのみ · 資料送信は未対応');
    expect(within(dialog).queryByRole('button', { name: '送信' })).toBeNull();
    expect(within(dialog).queryByRole('link')).toBeNull();
    fireEvent.click(within(dialog).getByRole('button', { name: '添付を外す' })); expect(cancel).toHaveBeenCalledOnce();
    fireEvent.click(within(dialog).getByRole('button', { name: '閉じる' })); expect(dismiss).toHaveBeenCalledOnce();
    expect(fetch).not.toHaveBeenCalled(); expect(websocket).not.toHaveBeenCalled(); expect(create).not.toHaveBeenCalled(); expect(persist).not.toHaveBeenCalled();
  });

  it('shows the current bounded PDF extraction contract without rendering the untrusted original', () => {
    const view = render(<AttachmentDetails kind="document" document={{ ...doc, name: 'DEMO.pdf', format: 'PDF', preview: '', extraction: 'pdf_text_pending' }}
      capabilities={capabilities} rawLimit={32_000} localOnly onCancel={() => undefined} onDismiss={() => undefined} />);
    expect(screen.getByText(/サーバーで最大3頁/)).toBeVisible();
    expect(screen.getByText('16KiB')).toBeVisible();
    expect(view.container.querySelector('iframe, embed, object, img')).toBeNull();
    expect(screen.queryByLabelText('選択した資料の端末内プレビュー')).toBeNull();
  });

  it('distinguishes a bounded text preview from the complete verified original', () => {
    render(<AttachmentDetails kind="document" document={{ ...doc, preview: 'DEMO'.repeat(1000), previewTruncated: true }}
      capabilities={null} rawLimit={32_000} localOnly={false} onCancel={() => undefined} onDismiss={() => undefined} />);
    expect(screen.getByText(/先頭4,000文字/)).toHaveTextContent('省略部分を含む原本を送信時に検証');
    expect(screen.getByRole('status')).toHaveTextContent('端末内のみ · 未転送');
  });

  it('uses a scoped Blob for the image preview and releases it on payload replacement and dismiss', () => {
    const create = vi.fn().mockReturnValueOnce('blob:DEMO-one').mockReturnValueOnce('blob:DEMO-two'), revoke = vi.fn();
    vi.stubGlobal('URL', { createObjectURL: create, revokeObjectURL: revoke });
    const view = render(<AttachmentDetails kind="image" image={image} capabilities={null} rawLimit={5_242_880} localOnly
      onCancel={() => undefined} onDismiss={() => undefined} />);
    expect(screen.getByRole('img')).toHaveAttribute('src', 'blob:DEMO-one');
    expect(screen.getByText(/実モデルでの画像解析は未確認/)).toBeVisible();
    const blob = create.mock.calls[0]![0] as Blob;
    expect(blob.size).toBe(image.bytes.byteLength); expect(blob.type).toBe(image.mime);
    view.rerender(<AttachmentDetails kind="image" image={{ ...image, bytes: image.bytes.slice() }} capabilities={null} rawLimit={5_242_880} localOnly
      onCancel={() => undefined} onDismiss={() => undefined} />);
    expect(revoke).toHaveBeenCalledWith('blob:DEMO-one'); expect(screen.getByRole('img')).toHaveAttribute('src', 'blob:DEMO-two');
    view.unmount(); expect(revoke).toHaveBeenCalledWith('blob:DEMO-two'); expect(revoke).toHaveBeenCalledTimes(2);
  });

  it.each(['uploading', 'accepted', 'delivery_unknown'] as const)('offers no local cancel or resend for a %s attachment', status => {
    const cancel = vi.fn();
    render(<AttachmentDetails kind="document" document={{ ...doc, status }} capabilities={null} rawLimit={32_000} localOnly={false}
      onCancel={cancel} onDismiss={() => undefined} />);
    expect(screen.queryByRole('button', { name: '添付を外す' })).toBeNull();
    expect(screen.queryByRole('button', { name: /送信|再送/ })).toBeNull();
    expect(screen.getByText(/閉じても送信・実行やVPS原本は取消・削除されません/)).toBeVisible();
    if (status === 'delivery_unknown') expect(screen.getByRole('alert')).toHaveTextContent('送信結果不明 · 自動再送しません');
    else if (status === 'accepted') expect(screen.getByRole('status')).toHaveTextContent('生成状態は別途確認');
    else expect(screen.getByRole('status')).toHaveTextContent('受付は未確認');
    expect(cancel).not.toHaveBeenCalled();
  });
});
