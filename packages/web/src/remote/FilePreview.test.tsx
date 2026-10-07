import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { FileContent } from '../../../core/src/features/files';
import { FilePreview } from './FilePreview';

const hash = 'a'.repeat(64);
const content: FileContent = { name: 'DEMO.md', mime: 'text/markdown', bytes: 4, text: 'DEMO', content_base64: null,
  etag: hash, sha256: hash, max_bytes: 1_048_576, truncated: false };
const create = vi.fn(() => 'blob:DEMO-snapshot'), revoke = vi.fn();
const share = vi.fn(), canShare = vi.fn(() => true);
beforeEach(() => {
  vi.clearAllMocks(); share.mockReset(); canShare.mockReset().mockReturnValue(true);
  Object.defineProperty(URL, 'createObjectURL', { value: create, configurable: true });
  Object.defineProperty(URL, 'revokeObjectURL', { value: revoke, configurable: true });
  vi.stubGlobal('navigator', { share, canShare });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

function beginShare() {
  fireEvent.click(screen.getByRole('button', { name: '端末の共有メニュー' }));
  fireEvent.click(screen.getByRole('button', { name: '共有先を選ぶ' }));
}
function deferred() {
  let resolve!: () => void, reject!: (error: Error) => void;
  const promise = new Promise<void>((accept, decline) => { resolve = accept; reject = decline; });
  return { promise, resolve, reject };
}

describe('explicit artifact save and share controls', () => {
  it.each(['ファイルを保存', '端末の共有メニュー'])('focuses the safe confirmation action and returns to %s on cancellation', name => {
    render(<FilePreview content={content} onClose={vi.fn()} />);
    const trigger = screen.getByRole('button', { name }); trigger.focus(); fireEvent.click(trigger);
    const cancel = screen.getByRole('button', { name: '取消' });
    expect(cancel).toHaveFocus(); expect(cancel).toHaveAccessibleDescription(/機密が含まれる場合/);
    expect(trigger).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('group', { name: 'ファイル保存の確認' })).toHaveAttribute('id', trigger.getAttribute('aria-controls'));
    expect(share).not.toHaveBeenCalled();
    fireEvent.click(cancel); expect(trigger).toHaveFocus(); expect(trigger).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('group', { name: 'ファイル保存の確認' })).toBeNull();
  });

  it('blocks another save or share while the explicit OS share is pending, retaining the close action', async () => {
    const pending = deferred(); share.mockReturnValue(pending.promise); const close = vi.fn();
    render(<FilePreview content={content} onClose={close} />); beginShare();
    expect(share).toHaveBeenCalledTimes(1); expect(share.mock.calls[0]![0].files).toHaveLength(1);
    const file = share.mock.calls[0]![0].files![0] as File;
    expect(file.size).toBe(4); expect(file.type).toBe('text/markdown'); expect(file.name).toMatch(/^hermes-artifact-.*\.md$/);
    expect(screen.getByRole('button', { name: 'ファイルを保存' })).toBeDisabled();
    const sharing = screen.getByRole('button', { name: '端末の共有メニュー' }); expect(sharing).toBeDisabled(); fireEvent.click(sharing);
    expect(screen.getByRole('region', { name: 'ファイルの内容' })).toHaveAttribute('aria-busy', 'true');
    expect(screen.queryByRole('group', { name: 'ファイル保存の確認' })).toBeNull(); expect(share).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: '一覧へ戻る' })); expect(close).toHaveBeenCalledOnce();
    await act(async () => { pending.resolve(); await pending.promise; });
    expect(sharing).toBeEnabled(); expect(screen.getByRole('status')).toHaveTextContent('共有先での保存は確認できません');
  });

  it.each(['success', 'failure'] as const)('ignores the old snapshot share %s after the user opens different content', async outcome => {
    const pending = deferred(); share.mockReturnValue(pending.promise);
    const view = render(<FilePreview content={content} onClose={vi.fn()} />); beginShare();
    view.rerender(<FilePreview content={{ ...content, name: 'DEMO-next.txt', mime: 'text/plain', text: 'NEXT' }} onClose={vi.fn()} />);
    expect(revoke).toHaveBeenCalledWith('blob:DEMO-snapshot');
    expect(screen.getByRole('status')).toBeEmptyDOMElement();
    await act(async () => {
      if (outcome === 'success') pending.resolve(); else pending.reject(new Error('DEMO-only failure'));
      await pending.promise.catch(() => undefined);
    });
    expect(screen.getByRole('heading', { name: 'DEMO-next.txt' })).toBeInTheDocument();
    expect(screen.getByRole('status')).toBeEmptyDOMElement();
    expect(screen.getByRole('button', { name: '端末の共有メニュー' })).toBeEnabled();
  });

  it('releases the snapshot on dismissal while ignoring its delayed share result', async () => {
    const pending = deferred(); share.mockReturnValue(pending.promise);
    const view = render(<FilePreview content={content} onClose={vi.fn()} />); beginShare(); view.unmount();
    await act(async () => { pending.resolve(); await pending.promise; });
    expect(revoke).toHaveBeenCalledOnce(); expect(screen.queryByRole('status')).toBeNull();
  });

  it('does not steal moved focus when the OS sharing operation ends', async () => {
    const pending = deferred(); share.mockReturnValue(pending.promise);
    render(<FilePreview content={content} onClose={vi.fn()} />); beginShare();
    const back = screen.getByRole('button', { name: '一覧へ戻る' }); back.focus();
    await act(async () => { pending.resolve(); await pending.promise; });
    expect(back).toHaveFocus();
  });

  it.each(['canShare', 'share'] as const)('handles a synchronous %s failure without leaving sharing busy or calling another API', method => {
    (method === 'canShare' ? canShare : share).mockImplementation(() => { throw new Error('DEMO-only browser refusal'); });
    render(<FilePreview content={content} onClose={vi.fn()} />); beginShare();
    expect(screen.getByRole('status')).toHaveTextContent('共有を開始できません');
    expect(screen.getByRole('button', { name: 'ファイルを保存' })).toBeEnabled();
    expect(screen.getByRole('region', { name: 'ファイルの内容' })).not.toHaveAttribute('aria-busy', 'true');
    expect(screen.getByRole('button', { name: '端末の共有メニュー' })).toHaveFocus();
    if (method === 'canShare') expect(share).not.toHaveBeenCalled();
  });

  it('reports a rejected browser download without claiming the file was saved or retaining its transient anchor', () => {
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => { throw new Error('DEMO download refusal'); });
    const { container } = render(<FilePreview content={content} onClose={vi.fn()} />);
    const trigger = screen.getByRole('button', { name: 'ファイルを保存' }); fireEvent.click(trigger);
    fireEvent.click(screen.getByRole('button', { name: '保存を開始' }));
    expect(click).toHaveBeenCalledOnce(); expect(screen.getByRole('status')).toHaveTextContent('保存を依頼できませんでした');
    expect(document.querySelector('a[download]')).toBeNull(); expect(trigger).toHaveFocus();
    expect(container.querySelector('input')).toBeNull(); expect(share).not.toHaveBeenCalled();
  });

  it('does not offer binary preview or export for an invalid bounded snapshot', () => {
    const { container } = render(<FilePreview content={{ ...content, mime: 'image/svg+xml', text: null, content_base64: btoa('DEMO') }} onClose={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'ファイルを保存' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '端末の共有メニュー' })).toBeDisabled();
    expect(container.querySelector('img, iframe')).toBeNull(); expect(create).not.toHaveBeenCalled();
  });
});
