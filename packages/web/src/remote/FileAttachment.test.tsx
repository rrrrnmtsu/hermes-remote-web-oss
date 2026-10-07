import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { RemoteDocument } from '../../../core/src/features/documents';
import { FileAttachment } from './FileAttachment';

const doc: RemoteDocument = { name: '<script>name.md', format: 'MARKDOWN', bytes: new TextEncoder().encode('synthetic'),
  preview: '<img src=x onerror=alert(1)>\n日本語\n```\ncode\n```', previewTruncated: false, extraction: 'utf8', status: 'selected' };
afterEach(cleanup);
describe('document attachment explicit UX', () => {
  it('renders literal safe preview and only emits local cancel/detail operations', () => {
    const cancel = vi.fn(); const details = vi.fn();
    const view = render(<FileAttachment document={doc} localOnly onCancel={cancel} onDetails={details} />);
    expect(screen.getByRole('status')).toHaveTextContent('資料送信は未対応');
    expect(view.container.querySelector('img, script, iframe')).toBeNull();
    expect(screen.queryByRole('button', { name: '送信' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '資料の詳細と上限' })); expect(details).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: '添付を外す' })); expect(cancel).toHaveBeenCalledTimes(1);
  });
  it('distinguishes original PDF and bounded extraction, never promises page images', () => {
    render(<FileAttachment document={{ ...doc, format: 'PDF', extraction: 'pdf_text_pending' }} localOnly={false} onCancel={() => undefined} onDetails={() => undefined} />);
    expect(screen.getByText(/PDF原本.*最大20頁/)).toBeVisible(); expect(screen.getByText(/ページ画像化は行いません/)).toBeVisible();
  });
  it.each(['uploading', 'accepted', 'delivery_unknown'] as const)('cannot falsely cancel a %s turn', status => {
    const cancel = vi.fn(); render(<FileAttachment document={{ ...doc, status }} localOnly={false} onCancel={cancel} onDetails={() => undefined} />);
    expect(screen.getByRole('button', { name: '添付を外す' })).toBeDisabled(); fireEvent.click(screen.getByRole('button', { name: '添付を外す' })); expect(cancel).not.toHaveBeenCalled();
  });
});
