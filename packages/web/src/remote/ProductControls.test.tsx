import { useState, useSyncExternalStore } from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FilesController, type FileContent } from '../../../core/src/features/files';
import type { InformationModels } from '../../../core/src/features/information';
import { RemoteController } from '../../../core/src/stores/remote';
import type { Http } from '../../../core/src/transport/http';
import { ProductControls, type ProductSelection } from './ProductControls';

const rootId = 'a'.repeat(64), artifactId = 'b'.repeat(64);
const file = { name: 'DEMO-file.txt', path: 'DEMO-file.txt', directory: false, bytes: 4, mime: 'text/plain', etag: rootId, readable: true, reason: '' };
const artifact = { id: artifactId, name: 'DEMO-artifact.txt', mime: 'text/plain', bytes: 4, etag: artifactId, producer: 'write_file', registered_at: 1 };
const methods = ['remote.files.roots', 'remote.files.list', 'remote.files.read', 'remote.artifacts.list', 'remote.artifacts.read'];
const fileContent: FileContent = { name: file.name, mime: 'text/plain', bytes: 4, text: 'FILE', content_base64: null, etag: rootId, sha256: rootId, max_bytes: 1_048_576, truncated: false };
const artifactContent: FileContent = { ...fileContent, name: artifact.name, text: 'ARTE', etag: artifactId, sha256: artifactId };
const readResponses = {
  'remote.files.read': { version: 1, profile: 'default', session_id: 'DEMO-live', root_id: rootId, path: file.path, content: fileContent },
  'remote.artifacts.read': { version: 1, profile: 'default', session_id: 'DEMO-live', artifact_id: artifactId, content: artifactContent },
};
const callbacks = { onOpen: vi.fn(), onInsert: vi.fn(), onSafetyChange: vi.fn(), onLogoutPreparation: vi.fn() };
const revoke = vi.fn();

function fixture(pendingMethod?: keyof typeof readResponses) {
  const http: Http = Object.assign(async <T,>(): Promise<T> => { throw new Error('No HTTP in this composition test'); }, { setProfile: () => undefined });
  const controller = new RemoteController({ http, origin: 'https://example.com', secure: true,
    makeGateway: () => { throw new Error('No WebSocket in this composition test'); }, withOperationLock: async action => action() });
  controller.store.setState({ connection: 'connected', principalId: 'DEMO:alice', profile: 'default', profiles: ['default'],
    liveId: 'DEMO-live', durableId: 'DEMO-durable', execution: 'idle', draft: 'DEMO preserved draft', featureMethods: methods });
  let finish!: (value: unknown) => void, fail!: (error: Error) => void;
  const pending = new Promise<unknown>((resolve, reject) => { finish = resolve; fail = reject; });
  const request = vi.spyOn(controller, 'featureRequest').mockImplementation(async <T,>(method: string, params: Record<string, unknown> = {}, write = false): Promise<T> => {
    expect(methods).toContain(method); expect(write).toBe(false);
    expect(params.profile).toBe('default'); expect(params.session_id).toBe('DEMO-live');
    if (method === pendingMethod) return await pending as T;
    if (method === 'remote.files.roots') return { version: 1, profile: 'default', session_id: 'DEMO-live', roots: [{ id: rootId, project_id: 'DEMO-project', name: 'DEMO root', folder_name: 'folder' }], truncated: false, max_bytes: 1_048_576 } as T;
    if (method === 'remote.files.list') return { version: 1, profile: 'default', session_id: 'DEMO-live', root_id: rootId, path: '', rows: [file], truncated: false, max_bytes: 1_048_576 } as T;
    if (method === 'remote.artifacts.list') return { version: 1, profile: 'default', session_id: 'DEMO-live', rows: [artifact], truncated: false, max_bytes: 1_048_576 } as T;
    return readResponses[method as keyof typeof readResponses] as T;
  });
  function Harness() {
    const [selection, onSelection] = useState<ProductSelection | null>(null);
    return <><button onClick={() => onSelection({ action: 'files' })}>Open DEMO files</button><button onClick={() => onSelection({ action: 'artifacts' })}>Open DEMO artifacts</button>
      <ProductControls controller={controller} state={controller.store.getState()} selection={selection} onSelection={onSelection}
        safeNavigate safeUpdate {...callbacks} /></>;
  }
  render(<Harness />);
  return { controller, request, finish: () => finish(readResponses[pendingMethod!]), fail: () => fail(new Error('DEMO read rejected')) };
}
async function openFiles() {
  fireEvent.click(screen.getByRole('button', { name: 'Open DEMO files' }));
  const dialog = screen.getByRole('dialog', { name: '登録projectのファイル' });
  fireEvent.click(await within(dialog).findByRole('button', { name: 'DEMO root / folder' }));
  return dialog;
}
async function openArtifacts() {
  fireEvent.click(screen.getByRole('button', { name: 'Open DEMO artifacts' }));
  const dialog = screen.getByRole('dialog', { name: 'この会話の成果物' });
  await within(dialog).findByRole('button', { name: artifact.name });
  return dialog;
}
function dismiss(dialog: HTMLElement, mode: 'button' | 'cancel') {
  if (mode === 'button') fireEvent.click(within(dialog).getByRole('button', { name: '閉じる' }));
  else fireEvent(dialog, new Event('cancel', { bubbles: false, cancelable: true }));
}

beforeEach(() => {
  Object.defineProperty(window.location, 'origin', { value: 'https://example.com', configurable: true });
  Object.defineProperty(HTMLDialogElement.prototype, 'showModal', { value: function(this: HTMLDialogElement) { this.open = true; }, configurable: true });
  Object.defineProperty(HTMLDialogElement.prototype, 'close', { value: function(this: HTMLDialogElement) { this.open = false; }, configurable: true });
  Object.defineProperty(URL, 'createObjectURL', { value: vi.fn(() => 'blob:DEMO-preview'), configurable: true });
  Object.defineProperty(URL, 'revokeObjectURL', { value: revoke, configurable: true });
  vi.clearAllMocks();
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe('file and artifact modal snapshot isolation', () => {
  it.each(['remote.files.read', 'remote.artifacts.read'] as const)('a double tap starts only one %s and read dismissal stays available', async method => {
    const { controller, request, finish } = fixture(method);
    const dialog = method === 'remote.files.read' ? await openFiles() : await openArtifacts();
    const row = await within(dialog).findByRole('button', { name: method === 'remote.files.read' ? file.name : artifact.name });
    fireEvent.click(row); fireEvent.click(row);
    expect(row).toBeDisabled(); expect(within(dialog).getByRole('button', { name: '閉じる' })).toBeEnabled();
    expect(request.mock.calls.filter(([requested]) => requested === method)).toHaveLength(1);
    await act(async () => { finish(); await pendingCalls(request); });
    await within(dialog).findByRole('region', { name: 'ファイルの内容' });
    expect(controller.store.getState().draft).toBe('DEMO preserved draft');
    expect(request.mock.calls.every(([, , write]) => !write)).toBe(true);
  });
  it('revalidates the normal artifact list after a failed content read before enabling that row again', async () => {
    const { request, fail } = fixture('remote.artifacts.read'); const dialog = await openArtifacts();
    fireEvent.click(within(dialog).getByRole('button', { name: artifact.name }));
    await act(async () => { fail(); await Promise.allSettled(request.mock.results.map(row => row.value)); });
    expect(within(dialog).getByRole('alert')).toHaveTextContent(/明示的に一覧を再取得/);
    expect(within(dialog).getByRole('button', { name: artifact.name })).toBeDisabled();
    fireEvent.click(within(dialog).getByRole('button', { name: '成果物を再取得' }));
    await waitFor(() => expect(within(dialog).getByRole('button', { name: artifact.name })).toBeEnabled());
    expect(request.mock.calls.filter(([method]) => method === 'remote.artifacts.list')).toHaveLength(2);
    expect(request.mock.calls.filter(([method]) => method === 'remote.artifacts.read')).toHaveLength(1);
    expect(request.mock.calls.every(([, , write]) => !write)).toBe(true);
  });
  it.each(['button', 'cancel'] as const)('closing the file %s clears its preview before artifact list and file reopening', async mode => {
    const { controller, request } = fixture();
    const files = await openFiles(); fireEvent.click(await within(files).findByRole('button', { name: file.name }));
    await within(files).findByRole('region', { name: 'ファイルの内容' }); dismiss(files, mode);
    expect(revoke).toHaveBeenCalledWith('blob:DEMO-preview');
    const artifacts = await openArtifacts();
    expect(within(artifacts).queryByRole('region', { name: 'ファイルの内容' })).toBeNull();
    fireEvent.click(within(artifacts).getByRole('button', { name: artifact.name }));
    await within(artifacts).findByRole('heading', { name: artifact.name }); dismiss(artifacts, mode);
    const reopened = await openFiles();
    expect(within(reopened).queryByRole('region', { name: 'ファイルの内容' })).toBeNull();
    expect(await within(reopened).findByRole('button', { name: file.name })).toBeInTheDocument();
    expect(controller.store.getState().draft).toBe('DEMO preserved draft');
    expect(request.mock.calls.every(([method, , write]) => methods.includes(method) && write !== true)).toBe(true);
    expect(callbacks.onInsert).not.toHaveBeenCalled(); expect(callbacks.onOpen).not.toHaveBeenCalled();
  });

  it.each(['remote.files.read', 'remote.artifacts.read'] as const)('a late %s completion after dismissal cannot reopen content in either modal', async method => {
    const { controller, request, finish } = fixture(method);
    const completion = method === 'remote.files.read' ? vi.spyOn(FilesController.prototype, 'openFile') : vi.spyOn(FilesController.prototype, 'openArtifact');
    if (method === 'remote.artifacts.read') {
      const initialFiles = await openFiles();
      await within(initialFiles).findByRole('button', { name: file.name });
      dismiss(initialFiles, 'button');
    }
    const outgoing = method === 'remote.files.read' ? await openFiles() : await openArtifacts();
    const name = method === 'remote.files.read' ? file.name : artifact.name;
    fireEvent.click(await within(outgoing).findByRole('button', { name }));
    expect(request.mock.calls.filter(([requested]) => requested === method)).toHaveLength(1);
    dismiss(outgoing, 'button');
    await act(async () => { finish(); await completion.mock.results[0]!.value; });
    const incoming = method === 'remote.files.read' ? await openArtifacts() : await openFiles();
    expect(within(incoming).queryByRole('region', { name: 'ファイルの内容' })).toBeNull();
    expect(await within(incoming).findByRole('button', { name: method === 'remote.files.read' ? artifact.name : file.name })).toBeInTheDocument();
    expect(controller.store.getState().draft).toBe('DEMO preserved draft');
    expect(request.mock.calls.filter(([requested]) => requested === method)).toHaveLength(1);
    expect(request.mock.calls.every(([requested, , write]) => methods.includes(requested) && write !== true)).toBe(true);
  });
});

describe('personal template dialog operation isolation', () => {
  function templatesFixture() {
    const http: Http = Object.assign(async <T,>(): Promise<T> => { throw new Error('No HTTP in this composition test'); }, { setProfile: () => undefined });
    const controller = new RemoteController({ http, origin: 'https://example.com', secure: true,
      makeGateway: () => { throw new Error('No WebSocket in this composition test'); }, withOperationLock: async action => action() });
    controller.store.setState({ connection: 'connected', principalId: 'DEMO:alice', profile: 'default', profiles: ['default'],
      liveId: 'DEMO-live', durableId: 'DEMO-durable', execution: 'idle', draft: 'DEMO preserved draft',
      featureMethods: ['remote.templates.list', 'remote.templates.put'] });
    let finish!: () => void;
    const pending = new Promise<void>(resolve => { finish = resolve; });
    const request = vi.spyOn(controller, 'featureRequest').mockImplementation(async <T,>(method: string, params: Record<string, unknown> = {}, write = false): Promise<T> => {
      expect(params.profile).toBe('default');
      if (method === 'remote.templates.list') {
        expect(write).toBe(false);
        return { templates: [], limit: 50, body_limit: 8000, storage_scope: 'authenticated_owner_profile_server' } as T;
      }
      expect(method).toBe('remote.templates.put'); expect(write).toBe(true);
      controller.store.setState({ featureBusy: true });
      await pending; controller.store.setState({ featureBusy: false });
      return { template: { ...params, id: 'DEMO-template', version: 1, updated_at: 1 } } as T;
    });
    function Harness() {
      const state = useSyncExternalStore(controller.store.subscribe, controller.store.getState, controller.store.getState);
      const [selection, onSelection] = useState<ProductSelection | null>(null);
      return <><button onClick={() => onSelection({ action: 'templates' })}>Open DEMO templates</button>
        <ProductControls controller={controller} state={state} selection={selection} onSelection={onSelection}
          safeNavigate safeUpdate {...callbacks} /></>;
    }
    render(<Harness />);
    fireEvent.click(screen.getByRole('button', { name: 'Open DEMO templates' }));
    return { controller, request, finish };
  }

  it('returns from the template content without losing the chat draft or submitting anything', async () => {
    const { controller, request } = templatesFixture();
    const dialog = await screen.findByRole('dialog', { name: '個人用定型文' });
    await within(dialog).findByLabelText('名前');
    expect(within(dialog).getByRole('region', { name: '個人用定型文の内容' })).toHaveAttribute('tabindex', '0');
    dismiss(dialog, 'button');
    expect(screen.queryByRole('dialog', { name: '個人用定型文' })).toBeNull();
    expect(controller.store.getState().draft).toBe('DEMO preserved draft');
    expect(request.mock.calls.every(([method, , write]) => method === 'remote.templates.list' && write !== true)).toBe(true);
    expect(callbacks.onInsert).not.toHaveBeenCalled(); expect(callbacks.onOpen).not.toHaveBeenCalled();
  });

  it('keeps the dialog and save result while the one explicit template write is pending', async () => {
    const { controller, request, finish } = templatesFixture();
    const dialog = await screen.findByRole('dialog', { name: '個人用定型文' });
    fireEvent.change(await within(dialog).findByLabelText('名前'), { target: { value: 'DEMO pending' } });
    fireEvent.change(within(dialog).getByLabelText('本文'), { target: { value: 'DEMO body' } });
    fireEvent.click(within(dialog).getByRole('button', { name: '定型文を保存' }));
    await waitFor(() => expect(within(dialog).getByRole('button', { name: '閉じる' })).toBeDisabled());
    dismiss(dialog, 'cancel');
    expect(screen.getByRole('dialog', { name: '個人用定型文' })).toBe(dialog);
    expect(request.mock.calls.filter(([method]) => method === 'remote.templates.put')).toHaveLength(1);
    await act(async () => { finish(); await pendingCalls(request); });
    await waitFor(() => expect(within(dialog).getByRole('button', { name: '閉じる' })).toBeEnabled());
    dismiss(dialog, 'cancel');
    expect(screen.queryByRole('dialog', { name: '個人用定型文' })).toBeNull();
    expect(controller.store.getState().draft).toBe('DEMO preserved draft');
    expect(request.mock.calls.filter(([method]) => method === 'remote.templates.put')).toHaveLength(1);
    expect(request.mock.calls.every(([method]) => ['remote.templates.list', 'remote.templates.put'].includes(method))).toBe(true);
  });
});

describe('information and project interaction isolation', () => {
  const infoMethods = ['remote.info.models', 'remote.info.commands', 'remote.session.model_set', 'remote.project.create_session'];
  const project = { id: 'DEMO-project', label: 'DEMO registered project', kind: 'registered' as const,
    sessionCount: 0, sessionIds: [], previews: [], lastActive: null };
  const created = { profile: 'default', session_id: 'DEMO-new-live', stored_session_id: 'DEMO-new-durable',
    project: { id: project.id, name: project.label, cwd: '/DEMO-isolated-project' } };
  function models(model = 'first'): InformationModels {
    return { version: 1, profile: 'default', session_id: 'DEMO-live', model, provider: 'DEMO', api_mode: 'native', endpoint_origin: null,
      revision: model, scope: 'configured_same_route', truncated: false,
      rows: ['first', 'next'].map(value => ({ model: value, provider: 'DEMO', current: value === model, listed: true,
        credential_present: null, response_confirmed: null, selectable: true, reason: '' })) };
  }
  function infoFixture({ pendingMethod = '', draft = '', projectControls = false, modelWriteSupported = true }: { pendingMethod?: string; draft?: string; projectControls?: boolean; modelWriteSupported?: boolean } = {}) {
    const http: Http = Object.assign(async <T,>(): Promise<T> => { throw new Error('No HTTP in this composition test'); }, { setProfile: () => undefined });
    const controller = new RemoteController({ http, origin: 'https://example.com', secure: true,
      makeGateway: () => { throw new Error('No WebSocket in this composition test'); }, withOperationLock: async action => action() });
    controller.store.setState({ connection: 'connected', principalId: 'DEMO:alice', profile: 'default', profiles: ['default', 'DEMO-other'],
      liveId: 'DEMO-live', durableId: 'DEMO-durable', execution: 'idle', draft,
      featureMethods: infoMethods.filter(method => modelWriteSupported || method !== 'remote.session.model_set'),
      projects: [project], projectsStatus: 'ready' });
    let resolve!: (value: unknown) => void, reject!: (error: Error) => void;
    const pending = new Promise<unknown>((finish, fail) => { resolve = finish; reject = fail; });
    const request = vi.spyOn(controller, 'featureRequest').mockImplementation(async <T,>(method: string, params: Record<string, unknown> = {}, write = false): Promise<T> => {
      expect(infoMethods).toContain(method); expect(params.profile).toBe('default');
      expect(write).toBe(['remote.session.model_set', 'remote.project.create_session'].includes(method));
      const captured = controller.featureScopeKey;
      if (write) controller.store.setState({ featureBusy: true });
      try {
        if (method === pendingMethod) return await pending as T;
        if (method === 'remote.info.models') return models() as T;
        if (method === 'remote.info.commands') return { version: 1, profile: 'default', rows: [], skills_state: 'available', truncated: false } as T;
        if (method === 'remote.session.model_set') return models(String(params.model)) as T;
        return created as T;
      } finally { if (write && controller.featureScopeKey === captured) controller.store.setState({ featureBusy: false }); }
    });
    function Harness() {
      const state = useSyncExternalStore(controller.store.subscribe, controller.store.getState, controller.store.getState);
      const [selection, onSelection] = useState<ProductSelection | null>(null);
      return <><button onClick={() => onSelection({ action: 'info' })}>Open DEMO information</button>
        <ProductControls controller={controller} state={state} selection={selection} onSelection={onSelection}
          browser={projectControls} safeNavigate safeUpdate {...callbacks} /></>;
    }
    render(<Harness />);
    return { controller, request, resolve, reject };
  }
  async function openInformation() {
    fireEvent.click(screen.getByRole('button', { name: 'Open DEMO information' }));
    const dialog = screen.getByRole('dialog', { name: '会話の情報' });
    await within(dialog).findByLabelText('次に使うモデル'); return dialog;
  }
  function confirmProject() {
    fireEvent.change(screen.getByLabelText('作業先'), { target: { value: project.id } });
    fireEvent.click(screen.getByRole('button', { name: 'この作業先で新規会話' }));
    return screen.getByRole('dialog', { name: '新規会話の作業先' });
  }

  it('opens with one model read and refuses repeated refresh taps until the current read settles', async () => {
    const { controller, request, resolve } = infoFixture({ pendingMethod: 'remote.info.models', draft: 'DEMO preserved draft' });
    fireEvent.click(screen.getByRole('button', { name: 'Open DEMO information' }));
    const dialog = screen.getByRole('dialog', { name: '会話の情報' });
    const refresh = within(dialog).getByRole('button', { name: '現在の情報を再取得' });
    expect(refresh).toBeDisabled(); fireEvent.click(refresh); fireEvent.click(refresh);
    expect(request.mock.calls.filter(([method]) => method === 'remote.info.models')).toHaveLength(1);
    expect(within(dialog).getByRole('button', { name: '閉じる' })).toBeEnabled();
    await act(async () => { resolve(models()); await pendingCalls(request); });
    expect(refresh).toBeEnabled(); dismiss(dialog, 'button');
    expect(controller.store.getState().draft).toBe('DEMO preserved draft');
    expect(request.mock.calls.every(([, , write]) => !write)).toBe(true);
  });
  it('shows the draft guard before an otherwise selectable model can be applied', async () => {
    const { controller, request } = infoFixture({ draft: 'DEMO preserved draft' }); const dialog = await openInformation();
    fireEvent.change(within(dialog).getByLabelText('次に使うモデル'), { target: { value: 'next' } });
    expect(within(dialog).getByRole('button', { name: 'この会話へ適用' })).toBeDisabled();
    expect(within(dialog).getByText(/入力内容は保持しています/)).toBeInTheDocument();
    expect(request.mock.calls.some(([, , write]) => write)).toBe(false);
    expect(controller.store.getState().draft).toBe('DEMO preserved draft');
  });
  it('exposes read-only models when the actual server advertises catalog reads without model writes', async () => {
    const { request } = infoFixture({ modelWriteSupported: false }); const dialog = await openInformation();
    expect(within(dialog).getByLabelText('次に使うモデル')).toBeDisabled();
    const apply = within(dialog).getByRole('button', { name: 'この会話へ適用' }); expect(apply).toBeDisabled(); fireEvent.click(apply);
    expect(within(dialog).getByText(/このHermes版はモデル変更に未対応です/)).toBeInTheDocument();
    expect(within(dialog).queryByText(/入力内容は保持しています/)).toBeNull();
    expect(request.mock.calls.filter(([method]) => method === 'remote.info.models')).toHaveLength(1);
    expect(request.mock.calls.some(([, , write]) => write)).toBe(false);
  });
  it('lets a changed catalog query supersede an in-flight read without repeating the same query or writing', async () => {
    const { request, resolve } = infoFixture({ pendingMethod: 'remote.info.commands', draft: 'DEMO preserved draft' }); const dialog = await openInformation();
    vi.useFakeTimers();
    try {
      fireEvent.click(within(dialog).getByRole('button', { name: 'Skills' }));
      await act(async () => { vi.advanceTimersByTime(250); });
      fireEvent.click(within(dialog).getByRole('button', { name: '現在の情報を再取得' }));
      fireEvent.change(within(dialog).getByLabelText('取得したcatalogを検索'), { target: { value: '日本語' } });
      await act(async () => { vi.advanceTimersByTime(250); });
      expect(request.mock.calls.filter(([method]) => method === 'remote.info.commands').map(([, params]) => params!.query)).toEqual(['', '日本語']);
      await act(async () => { resolve({ version: 1, profile: 'default', rows: [], skills_state: 'available', truncated: false }); await pendingCalls(request); });
      expect(request.mock.calls.some(([, , write]) => write)).toBe(false); expect(callbacks.onInsert).not.toHaveBeenCalled();
    } finally { vi.useRealTimers(); }
  });
  it('holds Close/Escape only for the single explicit model write, then releases after its readback', async () => {
    const { request, resolve } = infoFixture({ pendingMethod: 'remote.session.model_set' }); const dialog = await openInformation();
    fireEvent.change(within(dialog).getByLabelText('次に使うモデル'), { target: { value: 'next' } });
    const apply = within(dialog).getByRole('button', { name: 'この会話へ適用' }); fireEvent.click(apply); fireEvent.click(apply);
    expect(within(dialog).getByRole('button', { name: '閉じる' })).toBeDisabled(); dismiss(dialog, 'cancel');
    expect(screen.getByRole('dialog', { name: '会話の情報' })).toBe(dialog);
    expect(request.mock.calls.filter(([method]) => method === 'remote.session.model_set')).toHaveLength(1);
    await act(async () => { resolve(models('next')); await pendingCalls(request); });
    expect(within(dialog).getByRole('button', { name: '閉じる' })).toBeEnabled(); dismiss(dialog, 'cancel');
    expect(screen.queryByRole('dialog', { name: '会話の情報' })).toBeNull();
    expect(callbacks.onOpen).not.toHaveBeenCalled(); expect(callbacks.onInsert).not.toHaveBeenCalled();
  });
  it('keeps a lost model ACK unknown until explicit readback without reapplying the model or changing the chat', async () => {
    const { controller, request, reject } = infoFixture({ pendingMethod: 'remote.session.model_set' }); const dialog = await openInformation();
    fireEvent.change(within(dialog).getByLabelText('次に使うモデル'), { target: { value: 'next' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'この会話へ適用' }));
    await act(async () => { reject(new Error('DEMO lost model ACK')); await Promise.allSettled(request.mock.results.map(row => row.value)); });
    expect(within(dialog).getByText(/変更の結果不明/)).toBeInTheDocument();
    expect(within(dialog).getByLabelText('次に使うモデル')).toBeDisabled();
    const apply = within(dialog).getByRole('button', { name: 'この会話へ適用' }); expect(apply).toBeDisabled(); fireEvent.click(apply);
    expect(request.mock.calls.filter(([method]) => method === 'remote.session.model_set')).toHaveLength(1);
    fireEvent.click(within(dialog).getByRole('button', { name: '現在の情報を再取得' }));
    await waitFor(() => expect(within(dialog).queryByText(/変更の結果不明/)).toBeNull());
    expect(request.mock.calls.filter(([method]) => method === 'remote.session.model_set')).toHaveLength(1);
    expect(controller.store.getState().liveId).toBe('DEMO-live'); expect(controller.store.getState().durableId).toBe('DEMO-durable');
    expect(callbacks.onOpen).not.toHaveBeenCalled(); expect(callbacks.onInsert).not.toHaveBeenCalled();
  });
  it('retains a lost project ACK as unknown, explains it and never creates again on another tap', async () => {
    const { controller, request, reject } = infoFixture({ pendingMethod: 'remote.project.create_session', projectControls: true });
    const dialog = confirmProject(); const confirm = within(dialog).getByRole('button', { name: '確認して新規会話' });
    fireEvent.click(confirm); fireEvent.click(confirm);
    expect(within(dialog).getByRole('button', { name: '取消' })).toBeDisabled(); dismiss(dialog, 'cancel');
    expect(screen.getByRole('dialog', { name: '新規会話の作業先' })).toBe(dialog);
    expect(request.mock.calls.filter(([method]) => method === 'remote.project.create_session')).toHaveLength(1);
    await act(async () => { reject(new Error('DEMO lost ACK')); await Promise.allSettled(request.mock.results.map(row => row.value)); });
    expect(within(dialog).getByRole('alert')).toHaveTextContent(/自動で作り直しません/);
    expect(within(dialog).getByText(/受付結果が不明なため/)).toBeInTheDocument(); expect(confirm).toBeDisabled();
    expect(within(dialog).getByRole('button', { name: '取消' })).toBeEnabled(); fireEvent.click(within(dialog).getByRole('button', { name: '取消' }));
    const create = screen.getByRole('button', { name: 'この作業先で新規会話' }); expect(create).toBeDisabled(); fireEvent.click(create);
    expect(request.mock.calls.filter(([method]) => method === 'remote.project.create_session')).toHaveLength(1);
    expect(controller.store.getState().liveId).toBe('DEMO-live'); expect(callbacks.onOpen).not.toHaveBeenCalled();
  });
  it('opens the project session only after the existing controller adopts the official response', async () => {
    const { controller, request } = infoFixture({ projectControls: true });
    const adopt = vi.spyOn(controller, 'adoptCreatedSession'); const dialog = confirmProject();
    fireEvent.click(within(dialog).getByRole('button', { name: '確認して新規会話' }));
    await waitFor(() => expect(callbacks.onOpen).toHaveBeenCalledWith(created.stored_session_id));
    expect(adopt).toHaveBeenCalledOnce(); expect(controller.store.getState().liveId).toBe(created.session_id);
    expect(controller.store.getState().lineageId).toBe(created.stored_session_id);
    expect(request.mock.calls.filter(([, , write]) => write)).toHaveLength(1); expect(callbacks.onInsert).not.toHaveBeenCalled();
  });
  it('does not report the returned project session as opened when a new draft blocks adoption', async () => {
    const { controller, request, resolve } = infoFixture({ pendingMethod: 'remote.project.create_session', projectControls: true }); const dialog = confirmProject();
    fireEvent.click(within(dialog).getByRole('button', { name: '確認して新規会話' }));
    act(() => controller.setDraft('DEMO arrived while pending'));
    await act(async () => { resolve(created); await pendingCalls(request); });
    await screen.findByText(/現在の状態では開けませんでした/);
    expect(controller.store.getState().draft).toBe('DEMO arrived while pending'); expect(controller.store.getState().liveId).toBe('DEMO-live');
    expect(callbacks.onOpen).not.toHaveBeenCalled(); expect(request.mock.calls.filter(([, , write]) => write)).toHaveLength(1);
  });
  it('drops a late project result and the selected project when the profile scope changes', async () => {
    const { controller, request, resolve } = infoFixture({ pendingMethod: 'remote.project.create_session', projectControls: true }); const dialog = confirmProject();
    fireEvent.click(within(dialog).getByRole('button', { name: '確認して新規会話' }));
    act(() => controller.store.setState({ profile: 'DEMO-other', liveId: 'DEMO-other-live', durableId: 'DEMO-other-durable', featureBusy: false, draft: 'DEMO other scope' }));
    expect(screen.queryByRole('dialog', { name: '新規会話の作業先' })).toBeNull(); expect(screen.getByLabelText('作業先')).toHaveValue('');
    await act(async () => { resolve(created); await pendingCalls(request); });
    expect(controller.store.getState().profile).toBe('DEMO-other'); expect(controller.store.getState().draft).toBe('DEMO other scope');
    expect(callbacks.onOpen).not.toHaveBeenCalled(); expect(request.mock.calls.filter(([, , write]) => write)).toHaveLength(1);
  });
});

async function pendingCalls(request: { mock: { results: { value: unknown }[] } }) {
  await Promise.all(request.mock.results.map(row => row.value));
}
