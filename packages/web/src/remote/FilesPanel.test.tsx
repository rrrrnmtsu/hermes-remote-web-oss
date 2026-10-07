import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { FilesController, type FileContent } from '../../../core/src/features/files';
import { FilesPanel } from './FilesPanel';
import { ArtifactPanel } from './ArtifactPanel';
import { FilePreview } from './FilePreview';
import { contentBlob } from './file-content';

const hash = 'a'.repeat(64), content: FileContent = { name: 'DEMO.md', mime: 'text/markdown', bytes: 4, text: 'DEMO', content_base64: null, etag: hash, sha256: hash, max_bytes: 1_048_576, truncated: false };
const create = vi.fn(() => 'blob:DEMO-only'), revoke = vi.fn();
beforeEach(() => {
  Object.defineProperty(HTMLDialogElement.prototype, 'showModal', { value: function(this: HTMLDialogElement) { this.open = true; }, configurable: true });
  Object.defineProperty(HTMLDialogElement.prototype, 'close', { value: function(this: HTMLDialogElement) { this.open = false; }, configurable: true });
  Object.defineProperty(URL, 'createObjectURL', { value: create, configurable: true }); Object.defineProperty(URL, 'revokeObjectURL', { value: revoke, configurable: true });
  vi.clearAllMocks();
});
afterEach(cleanup);
function state() { const controller = new FilesController({ request: vi.fn() }); controller.setScope({ origin: 'https://DEMO.invalid', principal: 'DEMO:alice', profile: 'default', liveId: 'live', durableId: 'durable', generation: '1' }); return controller.store.getState(); }

describe('bounded file views', () => {
  const entry = { name: 'DEMO.md', path: 'DEMO.md', directory: false, bytes: 4, mime: 'text/markdown', etag: hash, readable: true, reason: '' };
  const artifact = { id: hash, name: 'DEMO.md', mime: 'text/markdown', bytes: 4, etag: hash, producer: 'write_file' as const, registered_at: 1 };
  function populated() {
    const value = state(); value.roots = [{ id: hash, project_id: 'DEMO', name: 'DEMO root', folder_name: 'folder' }];
    value.rootId = hash; value.rootsLoad = 'ready'; value.listLoad = 'ready'; value.artifactsLoad = 'ready';
    value.entries = [entry]; value.artifacts = [artifact]; return value;
  }
  it.each(['rootsLoad', 'listLoad', 'contentLoad'] as const)('blocks competing file reads during %s while allowing dismissal', field => {
    const value = populated(); value[field] = 'loading';
    const load = vi.fn(), browse = vi.fn(), open = vi.fn(), close = vi.fn();
    render(<FilesPanel state={value} onLoadRoots={load} onBrowse={browse} onOpen={open} onCloseContent={vi.fn()} onClose={close} />);
    load.mockClear();
    for (const name of ['登録先を再取得', 'DEMO root / folder', 'この一覧を再取得', 'DEMO.md']) {
      const button = screen.getByRole('button', { name }); expect(button).toBeDisabled(); fireEvent.click(button);
    }
    expect(screen.getByRole('region', { name: 'ファイルの一覧と内容' })).toHaveAttribute('aria-busy', 'true');
    expect(load).not.toHaveBeenCalled(); expect(browse).not.toHaveBeenCalled(); expect(open).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '閉じる' })); expect(close).toHaveBeenCalledOnce();
  });
  it('keeps a failed content read visible and permits the normal list read without reopening the stale file', () => {
    const value = populated(); value.contentLoad = 'error'; value.error = 'DEMO 内容を確認できません';
    const browse = vi.fn(), open = vi.fn();
    render(<FilesPanel state={value} onLoadRoots={vi.fn()} onBrowse={browse} onOpen={open} onCloseContent={vi.fn()} onClose={vi.fn()} />);
    expect(screen.getByRole('alert')).toHaveTextContent(value.error);
    expect(screen.getByRole('button', { name: 'DEMO.md' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'この一覧を再取得' })); expect(browse).toHaveBeenCalledWith(hash, '');
    expect(open).not.toHaveBeenCalled();
  });
  it.each(['artifactsLoad', 'contentLoad'] as const)('does not queue another artifact read during %s', field => {
    const value = populated(); value[field] = 'loading'; const load = vi.fn(), open = vi.fn();
    render(<ArtifactPanel state={value} onLoad={load} onOpen={open} onCloseContent={vi.fn()} onClose={vi.fn()} />); load.mockClear();
    expect(screen.getByRole('button', { name: '成果物を再取得' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'DEMO.md' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: '成果物を再取得' })); fireEvent.click(screen.getByRole('button', { name: 'DEMO.md' }));
    expect(load).not.toHaveBeenCalled(); expect(open).not.toHaveBeenCalled();
  });
  it.each(['file', 'artifact'] as const)('returns from a %s preview to its selected row and scroll position, discarding that position across scope', kind => {
    const value = populated(), closeContent = vi.fn();
    const renderView = (current: ReturnType<typeof state>) => kind === 'file'
      ? <FilesPanel state={current} onLoadRoots={vi.fn()} onBrowse={vi.fn()} onOpen={vi.fn()} onCloseContent={closeContent} onClose={vi.fn()} />
      : <ArtifactPanel state={current} onLoad={vi.fn()} onOpen={vi.fn()} onCloseContent={closeContent} onClose={vi.fn()} />;
    const view = render(renderView(value)); const body = screen.getByRole('region', { name: kind === 'file' ? 'ファイルの一覧と内容' : '成果物の一覧と内容' });
    body.scrollTop = 320; fireEvent.scroll(body); const row = screen.getByRole('button', { name: 'DEMO.md' }); row.focus(); fireEvent.click(row);
    view.rerender(renderView({ ...value, content })); expect(body.scrollTop).toBe(0);
    expect(screen.getByRole('button', { name: '一覧へ戻る' })).toHaveFocus();
    fireEvent.click(screen.getByRole('button', { name: '一覧へ戻る' })); expect(closeContent).toHaveBeenCalledOnce();
    view.rerender(renderView(value)); expect(body.scrollTop).toBe(320); expect(screen.getByRole('button', { name: 'DEMO.md' })).toHaveFocus();
    view.rerender(renderView({ ...value, scope: { ...value.scope!, profile: 'DEMO-other', generation: '2' } }));
    expect(body.scrollTop).toBe(0);
  });
  it.each(['file', 'artifact'] as const)('does not steal a moved Close focus when %s content arrives asynchronously', kind => {
    const value = populated();
    const renderView = (current: ReturnType<typeof state>) => kind === 'file'
      ? <FilesPanel state={current} onLoadRoots={vi.fn()} onBrowse={vi.fn()} onOpen={vi.fn()} onCloseContent={vi.fn()} onClose={vi.fn()} />
      : <ArtifactPanel state={current} onLoad={vi.fn()} onOpen={vi.fn()} onCloseContent={vi.fn()} onClose={vi.fn()} />;
    const view = render(renderView(value)); const close = screen.getByRole('button', { name: '閉じる' }); close.focus();
    view.rerender(renderView({ ...value, content })); expect(close).toHaveFocus();
  });
  it('registered roots list only uses explicit browsing callbacks', () => {
    const value = state(); value.roots = [{ id: hash, project_id: 'p', name: 'DEMO project', folder_name: 'folder' }];
    const browse = vi.fn(), load = vi.fn(); const { rerender } = render(<FilesPanel state={value} onLoadRoots={load} onBrowse={browse} onOpen={vi.fn()} onCloseContent={vi.fn()} onClose={vi.fn()} />);
    expect(load).toHaveBeenCalledTimes(1); expect(browse).not.toHaveBeenCalled(); fireEvent.click(screen.getByRole('button', { name: 'DEMO project / folder' }));
    expect(browse).toHaveBeenCalledWith(hash, ''); rerender(<FilesPanel state={value} onLoadRoots={vi.fn()} onBrowse={browse} onOpen={vi.fn()} onCloseContent={vi.fn()} onClose={vi.fn()} />);
    expect(load).toHaveBeenCalledTimes(1);
  });
  it('empty canonical artifact range is not inferred from answer paths', () => {
    const value = state(); value.artifactsLoad = 'ready'; render(<ArtifactPanel state={value} onLoad={vi.fn()} onOpen={vi.fn()} onCloseContent={vi.fn()} onClose={vi.fn()} />);
    expect(screen.getByText(/過去の回答にファイル名があっても/)).toBeInTheDocument(); expect(screen.queryByRole('button', { name: /生成|削除/ })).toBeNull();
  });
  it('safe Markdown refuses HTML, invalid links and external image loads', () => {
    const text = '<script>DEMO</script>\n\n[bad](javascript:alert(1))\n\n![image](https://DEMO.invalid/private.png)';
    const { container } = render(<FilePreview content={{ ...content, text, bytes: new TextEncoder().encode(text).length }} onClose={vi.fn()} />);
    expect(container.querySelector('script')).toBeNull(); expect(container.querySelector('a[href^="javascript:"]')).toBeNull(); expect(container.querySelector('img[src^="https:"]')).toBeNull();
  });
  it('download requires confirmation and cancelling writes nothing', () => {
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    const { unmount } = render(<FilePreview content={content} onClose={vi.fn()} />);
    expect(click).not.toHaveBeenCalled(); fireEvent.click(screen.getByRole('button', { name: 'ファイルを保存' }));
    expect(screen.getByText(/端末のファイルに残ります/)).toBeInTheDocument(); fireEvent.click(screen.getByRole('button', { name: '取消' })); expect(click).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'ファイルを保存' })); fireEvent.click(screen.getByRole('button', { name: '保存を開始' })); expect(click).toHaveBeenCalledTimes(1);
    expect(screen.getByText(/保存完了は確認できません/)).toBeInTheDocument(); unmount(); expect(revoke).toHaveBeenCalledWith('blob:DEMO-only'); click.mockRestore();
  });
  it('UTF-8 snapshots have exact size and unsafe binary MIME/capacity is rejected', () => {
    expect(contentBlob(content).size).toBe(4); expect(() => contentBlob({ ...content, bytes: 3 })).toThrow(); expect(() => contentBlob({ ...content, mime: 'image/svg+xml' })).toThrow();
  });
  it('PDF preview sandbox has no scripting capability', () => {
    const { container } = render(<FilePreview content={{ ...content, mime: 'application/pdf', text: null, content_base64: btoa('DEMO') }} onClose={vi.fn()} />);
    expect(container.querySelector('iframe')?.getAttribute('sandbox')).toBe(''); expect(container.querySelector('iframe')?.getAttribute('referrerpolicy')).toBe('no-referrer');
  });
});
