import { createStore } from 'zustand/vanilla';
import type { InformationScope } from './information';

export interface FilesPort { request<T>(method: string, params: Record<string, unknown>): Promise<T>; }
export interface FileRoot { id: string; project_id: string; name: string; folder_name: string; }
export interface FileEntry { name: string; path: string; directory: boolean; bytes: number | null; mime: string | null; etag: string; readable: boolean; reason: string; }
export interface ArtifactEntry { id: string; name: string; mime: string; bytes: number; etag: string; producer: 'write_file'; registered_at: number; }
export interface FileContent { name: string; mime: string; bytes: number; etag: string; sha256: string; text: string | null; content_base64: string | null; max_bytes: number; truncated: boolean; }
export type FilesLoad = 'idle' | 'loading' | 'ready' | 'unsupported' | 'error';
export interface FilesState {
  scope: InformationScope | null; roots: FileRoot[]; rootId: string; path: string; entries: FileEntry[]; artifacts: ArtifactEntry[];
  rootsLoad: FilesLoad; listLoad: FilesLoad; artifactsLoad: FilesLoad; contentLoad: FilesLoad;
  content: FileContent | null; error: string; truncated: boolean; artifactsTruncated: boolean; maxBytes: number;
}
const initial = (): FilesState => ({ scope: null, roots: [], rootId: '', path: '', entries: [], artifacts: [], rootsLoad: 'idle', listLoad: 'idle', artifactsLoad: 'idle', contentLoad: 'idle', content: null, error: '', truncated: false, artifactsTruncated: false, maxBytes: 1_048_576 });
const key = (scope: InformationScope | null): string => scope ? JSON.stringify(scope) : '';
const mimes = new Set(['text/markdown', 'text/plain', 'text/csv', 'application/json', 'image/png', 'image/jpeg', 'application/pdf']);
export function validFileContent(content: FileContent): boolean {
  if (!content || !mimes.has(content.mime) || !Number.isInteger(content.bytes) || content.bytes < 0 || content.bytes > 1_048_576 || content.truncated
    || !/^[a-f0-9]{64}$/.test(content.etag) || !/^[a-f0-9]{64}$/.test(content.sha256)) return false;
  const binary = content.mime.startsWith('image/') || content.mime === 'application/pdf';
  return binary ? content.text === null && typeof content.content_base64 === 'string' && content.content_base64.length <= 4 * Math.ceil(1_048_576 / 3)
    && /^[A-Za-z0-9+/]*={0,2}$/.test(content.content_base64) : typeof content.text === 'string' && content.text.length <= 1_048_576 && content.content_base64 === null
      && new TextEncoder().encode(content.text).length === content.bytes;
}

/** Bounded explicit reads only; no file-write, registration, polling or path inference API. */
export class FilesController {
  readonly store = createStore<FilesState>(() => initial());
  private capabilities = new Set<string>();
  private revision = 0;
  constructor(private readonly port: FilesPort) {}
  setScope(scope: InformationScope | null, methods: readonly string[] = []): void {
    this.capabilities = new Set(methods);
    if (key(scope) !== key(this.store.getState().scope)) { this.revision++; this.store.setState({ ...initial(), scope }); }
  }
  clear(): void { this.setScope(null); }
  private cancelledLoads(): Pick<FilesState, 'rootsLoad' | 'listLoad' | 'artifactsLoad' | 'contentLoad'> {
    const state = this.store.getState();
    const load = (value: FilesLoad): FilesLoad => value === 'loading' ? 'idle' : value;
    return { rootsLoad: load(state.rootsLoad), listLoad: load(state.listLoad),
      artifactsLoad: load(state.artifactsLoad), contentLoad: load(state.contentLoad) };
  }
  closeContent(): void { this.revision++; this.store.setState({ ...this.cancelledLoads(), content: null, contentLoad: 'idle' }); }
  private async read<T extends { version: number; profile: string; session_id?: string; content?: FileContent }>(method: string, params: Record<string, unknown>, field: 'rootsLoad' | 'listLoad' | 'artifactsLoad' | 'contentLoad', apply: (result: T) => void): Promise<void> {
    const scope = this.store.getState().scope;
    if (!scope?.liveId) { this.store.setState({ [field]: 'unsupported' }); return; }
    if (!this.capabilities.has(method)) { this.store.setState({ [field]: 'unsupported' }); return; }
    const revision = ++this.revision;
    // All reads share one revision. Release only cancelled loading flags;
    // previously verified rows/statuses remain authoritative and unchanged.
    this.store.setState({ ...this.cancelledLoads(), [field]: 'loading', error: '' });
    try {
      const result = await this.port.request<T>(method, { profile: scope.profile, session_id: scope.liveId, ...params });
      if (key(scope) !== key(this.store.getState().scope) || revision !== this.revision) return;
      if (result.version !== 1 || result.profile !== scope.profile || result.session_id !== scope.liveId
        || (result.content && !validFileContent(result.content))) throw new Error('scope_or_content_contract');
      apply(result); this.store.setState({ [field]: 'ready' });
    } catch {
      if (key(scope) === key(this.store.getState().scope) && revision === this.revision) this.store.setState({ [field]: 'error', error: 'ファイルを確認できません。権限・変更・形式・容量を確認し、明示的に一覧を再取得してください。' });
    }
  }
  async loadRoots(): Promise<void> {
    await this.read<{ version: number; profile: string; roots: FileRoot[]; truncated: boolean; max_bytes: number }>('remote.files.roots', {}, 'rootsLoad', result => {
      this.store.setState({ roots: result.roots.slice(0, 100), truncated: result.truncated, maxBytes: Math.min(result.max_bytes, 1_048_576) });
      if (!result.roots.some(root => root.id === this.store.getState().rootId)) this.store.setState({ rootId: '', path: '', entries: [], content: null });
    });
  }
  async browse(rootId: string, path = ''): Promise<void> {
    if (!this.store.getState().roots.some(root => root.id === rootId)) return;
    this.store.setState({ content: null, contentLoad: 'idle' });
    await this.read<{ version: number; profile: string; root_id: string; path: string; rows: FileEntry[]; truncated: boolean; max_bytes: number }>('remote.files.list', { root_id: rootId, path }, 'listLoad', result => {
      if (result.root_id !== rootId || result.path !== path) throw new Error('root_readback');
      this.store.setState({ rootId, path, entries: result.rows.slice(0, 100), truncated: result.truncated, maxBytes: Math.min(result.max_bytes, 1_048_576) });
    });
  }
  async openFile(entry: FileEntry): Promise<void> {
    const state = this.store.getState();
    if (entry.directory || !entry.readable || !state.entries.some(row => row.path === entry.path && row.etag === entry.etag)) return;
    this.store.setState({ content: null });
    await this.read<{ version: number; profile: string; root_id: string; path: string; content: FileContent }>('remote.files.read', { root_id: state.rootId, path: entry.path, expected_etag: entry.etag }, 'contentLoad', result => {
      if (result.root_id !== state.rootId || result.path !== entry.path || result.content.etag !== entry.etag) throw new Error('file_readback');
      this.store.setState({ content: result.content });
    });
  }
  async loadArtifacts(): Promise<void> {
    const scope = this.store.getState().scope;
    if (!scope?.liveId) { this.store.setState({ artifactsLoad: 'unsupported' }); return; }
    await this.read<{ version: number; profile: string; session_id: string; rows: ArtifactEntry[]; truncated: boolean; max_bytes: number }>('remote.artifacts.list', { session_id: scope.liveId }, 'artifactsLoad', result => {
      this.store.setState({ artifacts: result.rows.slice(0, 100), artifactsTruncated: result.truncated, maxBytes: Math.min(result.max_bytes, 1_048_576) });
    });
  }
  async openArtifact(entry: ArtifactEntry): Promise<void> {
    const scope = this.store.getState().scope;
    if (!scope?.liveId || !this.store.getState().artifacts.some(row => row.id === entry.id && row.etag === entry.etag)) return;
    this.store.setState({ content: null });
    await this.read<{ version: number; profile: string; session_id: string; artifact_id: string; content: FileContent }>('remote.artifacts.read', { session_id: scope.liveId, artifact_id: entry.id, expected_etag: entry.etag }, 'contentLoad', result => {
      if (result.artifact_id !== entry.id || result.content.etag !== entry.etag) throw new Error('artifact_readback');
      this.store.setState({ content: result.content });
    });
  }
}
