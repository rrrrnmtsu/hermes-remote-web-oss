import { describe, expect, it, vi } from 'vitest';
import { FilesController, validFileContent, type FileContent } from './files';
import type { InformationScope } from './information';

const hash = 'a'.repeat(64), scope: InformationScope = { origin: 'https://DEMO.invalid', principal: 'DEMO:alice', profile: 'default', liveId: 'live', durableId: 'durable', generation: '1' };
const methods = ['remote.files.roots', 'remote.files.list', 'remote.files.read', 'remote.artifacts.list', 'remote.artifacts.read'];
const content: FileContent = { name: 'DEMO.txt', mime: 'text/plain', text: 'DEMO', content_base64: null, bytes: 4, etag: hash, sha256: hash, max_bytes: 1_048_576, truncated: false };
function fixture(request = vi.fn()) { const controller = new FilesController({ request }); controller.setScope(scope, methods); return { controller, request }; }
async function loaded() {
  const request = vi.fn().mockResolvedValueOnce({ version: 1, profile: 'default', session_id: 'live', roots: [{ id: hash, project_id: 'p', name: 'DEMO', folder_name: 'folder' }], truncated: false, max_bytes: 1_048_576 })
    .mockResolvedValueOnce({ version: 1, profile: 'default', session_id: 'live', root_id: hash, path: '', rows: [{ name: 'DEMO.txt', path: 'DEMO.txt', directory: false, bytes: 4, mime: 'text/plain', etag: hash, readable: true, reason: '' }], truncated: false, max_bytes: 1_048_576 });
  const value = fixture(request); await value.controller.loadRoots(); await value.controller.browse(hash); return value;
}

describe('registered file and artifact adapter', () => {
  it('old backend unsupported does not send guessed RPCs', async () => {
    const { controller, request } = fixture(); controller.setScope(scope, []); await controller.loadRoots(); await controller.loadArtifacts();
    expect(request).not.toHaveBeenCalled(); expect(controller.store.getState().rootsLoad).toBe('unsupported');
  });
  it('only reads a listed root and entry with the exact version', async () => {
    const { controller, request } = await loaded(); request.mockResolvedValue({ version: 1, profile: 'default', session_id: 'live', root_id: hash, path: 'DEMO.txt', content });
    await controller.openFile(controller.store.getState().entries[0]!);
    expect(request).toHaveBeenLastCalledWith('remote.files.read', { profile: 'default', session_id: 'live', root_id: hash, path: 'DEMO.txt', expected_etag: hash });
    expect(controller.store.getState().content).toEqual(content);
    await controller.browse('unknown'); expect(request).toHaveBeenCalledTimes(3);
    expect(request.mock.calls.every(call => String(call[0]).startsWith('remote.files.'))).toBe(true);
  });
  it.each(['profile', 'principal', 'origin', 'liveId', 'durableId', 'generation'] as const)('late %s response is dropped', async field => {
    let resolve!: (value: unknown) => void; const { controller } = fixture(vi.fn(() => new Promise(yes => { resolve = yes; })));
    const pending = controller.loadRoots(); controller.setScope({ ...scope, [field]: 'changed' }, methods);
    resolve({ version: 1, profile: 'default', session_id: 'live', roots: [], max_bytes: 1_048_576, truncated: false }); await pending;
    expect(controller.store.getState().rootsLoad).toBe('idle');
  });
  it('wrong profile and oversized unsafe data fail closed', async () => {
    const { controller, request } = await loaded(); request.mockResolvedValue({ version: 1, profile: 'other', root_id: hash, path: 'DEMO.txt', content });
    await controller.openFile(controller.store.getState().entries[0]!); expect(controller.store.getState().content).toBeNull();
    expect(controller.store.getState().contentLoad).toBe('error');
    expect(validFileContent({ ...content, bytes: 1_048_577 })).toBe(false); expect(validFileContent({ ...content, mime: 'text/html' })).toBe(false);
    expect(validFileContent({ ...content, truncated: true })).toBe(false);
    expect(validFileContent({ ...content, text: '日本語', bytes: 3 })).toBe(false);
  });
  it('missing live session is not a registered-folder read grant', async () => {
    const { controller, request } = fixture(); controller.setScope({ ...scope, liveId: '' }, methods); await controller.loadRoots();
    expect(request).not.toHaveBeenCalled(); expect(controller.store.getState().rootsLoad).toBe('unsupported');
  });
  it('removed root clears its previous list instead of keeping a stale browsing scope', async () => {
    const { controller, request } = await loaded(); request.mockResolvedValue({ version: 1, profile: 'default', session_id: 'live', roots: [], truncated: false, max_bytes: 1_048_576 });
    await controller.loadRoots(); expect(controller.store.getState().rootId).toBe(''); expect(controller.store.getState().entries).toEqual([]);
  });
  it('closing content cancels a pending root read without calling it ready or retrying', async () => {
    let release!: (value: unknown) => void;
    const request = vi.fn(() => new Promise(resolve => { release = resolve; }));
    const { controller } = fixture(request); const pending = controller.loadRoots();
    expect(controller.store.getState().rootsLoad).toBe('loading'); controller.closeContent();
    expect(controller.store.getState().rootsLoad).toBe('idle');
    release({ version: 1, profile: 'default', session_id: 'live', roots: [{ id: hash }], max_bytes: 1_048_576, truncated: false });
    await pending; expect(controller.store.getState().roots).toEqual([]); expect(controller.store.getState().rootsLoad).toBe('idle');
    expect(request).toHaveBeenCalledTimes(1);
  });
  it('a newer read releases the older loading flag but retains exact late-response rejection', async () => {
    let release!: (value: unknown) => void;
    const request = vi.fn().mockImplementationOnce(() => new Promise(resolve => { release = resolve; }))
      .mockResolvedValueOnce({ version: 1, profile: 'default', session_id: 'live', rows: [], max_bytes: 1_048_576, truncated: false });
    const { controller } = fixture(request); const pending = controller.loadRoots(); await controller.loadArtifacts();
    expect(controller.store.getState().rootsLoad).toBe('idle'); expect(controller.store.getState().artifactsLoad).toBe('ready');
    release({ version: 1, profile: 'default', session_id: 'live', roots: [{ id: hash }], max_bytes: 1_048_576, truncated: false });
    await pending; expect(controller.store.getState().roots).toEqual([]); expect(request).toHaveBeenCalledTimes(2);
  });
  it('cancellation preserves previously verified lists and their status', async () => {
    const { controller, request } = await loaded(); const entries = controller.store.getState().entries;
    let release!: (value: unknown) => void; request.mockImplementationOnce(() => new Promise(resolve => { release = resolve; }));
    const pending = controller.loadRoots(); controller.closeContent();
    expect(controller.store.getState().listLoad).toBe('ready'); expect(controller.store.getState().entries).toEqual(entries);
    release({ version: 1, profile: 'default', session_id: 'live', roots: [], max_bytes: 1_048_576, truncated: false }); await pending;
    expect(controller.store.getState().entries).toEqual(entries); expect(controller.store.getState().rootsLoad).toBe('idle');
  });
  it('formal artifact ID read stays current-session only without any registration/write RPC', async () => {
    const row = { id: hash, name: 'DEMO.txt', mime: 'text/plain', bytes: 4, etag: hash, producer: 'write_file' as const, registered_at: 1 };
    const request = vi.fn().mockResolvedValueOnce({ version: 1, profile: 'default', session_id: 'live', rows: [row], max_bytes: 1_048_576, truncated: false })
      .mockResolvedValueOnce({ version: 1, profile: 'default', session_id: 'live', artifact_id: hash, content });
    const { controller } = fixture(request); await controller.loadArtifacts(); await controller.openArtifact(row);
    expect(request).toHaveBeenLastCalledWith('remote.artifacts.read', { profile: 'default', session_id: 'live', artifact_id: hash, expected_etag: hash });
    controller.clear(); expect(controller.store.getState().content).toBeNull(); expect(controller.store.getState().artifacts).toEqual([]);
  });
});
