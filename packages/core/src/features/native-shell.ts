/** Narrow iOS bridge. No backend RPC, origin switching, credentials or automatic send methods. */
export const NATIVE_BRIDGE_VERSION = 1;
export const NATIVE_SHARE_FILE_LIMIT = 5 * 1024 * 1024;
export const NATIVE_TEXT_LIMIT = 64 * 1024;
export const NATIVE_STORAGE_LIMIT = 1024 * 1024;
export interface NativeScope { origin: string; principal: string; profile: string; durableSession: string }
export interface NativeEnvelope {
  version: 1; id: string; method: NativeMethod; scope: NativeScope | null; params: Record<string, unknown>;
}
export type NativeMethod = 'device.capabilities' | 'device.authenticate' | 'device.invalidate' | 'storage.save' | 'storage.read'
  | 'storage.remove' | 'share.pending' | 'share.accept' | 'share.finish' | 'share.cancel';
export interface NativeChannel { postMessage(message: NativeEnvelope): Promise<unknown> }
export interface NativeCapabilities { version: 1; origin: string; scopeInvalidationVersion: 1; keychain: boolean; sharing: boolean; maxFileBytes: number; maxStorageBytes: number }
export interface NativeShareMetadata { id: string; kind: 'text' | 'file'; name: string; bytes: number; expiresAt: number }
export interface NativeSharedDraft extends NativeShareMetadata { text: string; mime: string; contentBase64: string }
export class NativeBridgeError extends Error {
  constructor(readonly code: 'unavailable' | 'invalid' | 'unsupported' | 'scope_changed' | 'timeout' | 'denied' | 'expired' | 'too_large') { super(code); this.name = 'NativeBridgeError'; }
}

export function nativeApprovedOrigin(value: string): string {
  let url: URL;
  try { url = new URL(value); } catch { throw new NativeBridgeError('invalid'); }
  if (url.protocol !== 'https:' || !url.hostname || url.username || url.password || url.search || url.hash
    || url.pathname !== '/' || value !== url.origin) throw new NativeBridgeError('invalid');
  return url.origin;
}
function validScope(scope: NativeScope, origin: string): NativeScope {
  if (scope.origin !== origin || [scope.principal, scope.profile, scope.durableSession].some(value => typeof value !== 'string'
    || !value || value.length > 200 || [...value].some(char => char.charCodeAt(0) < 32))) throw new NativeBridgeError('invalid');
  return { origin: scope.origin, principal: scope.principal, profile: scope.profile, durableSession: scope.durableSession };
}
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new NativeBridgeError('invalid');
  return value as Record<string, unknown>;
}
function shareMetadata(value: unknown): NativeShareMetadata | null {
  if (value === null) return null;
  const item = record(value);
  if (typeof item.id !== 'string' || !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(item.id) || !['text', 'file'].includes(String(item.kind))
    || typeof item.name !== 'string' || item.name.length > 120 || item.name.includes('/') || item.name.includes('\\')
    || typeof item.bytes !== 'number' || !Number.isSafeInteger(item.bytes) || item.bytes <= 0
    || item.bytes > (item.kind === 'text' ? NATIVE_TEXT_LIMIT : NATIVE_SHARE_FILE_LIMIT)
    || typeof item.expiresAt !== 'number' || !Number.isSafeInteger(item.expiresAt)) throw new NativeBridgeError('invalid');
  return { id: item.id, kind: item.kind as 'text' | 'file', name: item.name, bytes: item.bytes, expiresAt: item.expiresAt };
}

export class NativeShellClient {
  private scope: NativeScope | null = null;
  private generation = 0;
  private nextId = 0;
  private pending = new Map<string, (error: NativeBridgeError) => void>();
  private scopeInvalidationSupported = false;
  readonly origin: string;
  constructor(origin: string, private readonly channel: NativeChannel, private readonly now: () => number = Date.now,
    private readonly timeoutMs = 30_000) { this.origin = nativeApprovedOrigin(origin); }
  setScope(scope: NativeScope | null): void {
    const next = scope ? validScope(scope, this.origin) : null;
    if (JSON.stringify(next) !== JSON.stringify(this.scope)) {
      const notifyNative = this.scope !== null;
      this.generation += 1; this.scope = next; this.rejectPending();
      if (notifyNative) this.invalidateNative();
    }
    this.scope = next;
  }
  invalidate(): void { this.generation += 1; this.scope = null; this.rejectPending(); this.invalidateNative(); }
  private rejectPending(): void {
    for (const reject of this.pending.values()) reject(new NativeBridgeError('scope_changed'));
    this.pending.clear();
  }
  private invalidateNative(): void {
    const packet: NativeEnvelope = { version: 1, id: `native-${++this.nextId}`, method: 'device.invalidate', scope: null, params: {} };
    // Best-effort control only. An unknown/late ACK cannot restore a scope or retry
    // storage/share work. This method carries no content or backend operation.
    try { void Promise.resolve(this.channel.postMessage(packet)).catch(() => undefined); } catch { /* Keep local invalidation final. */ }
  }
  private async call(method: NativeMethod, params: Record<string, unknown> = {}, scoped = true): Promise<unknown> {
    if (scoped && !this.scope) throw new NativeBridgeError('denied');
    if (scoped && !this.scopeInvalidationSupported) throw new NativeBridgeError('unsupported');
    const generation = this.generation; const id = `native-${++this.nextId}`;
    const packet: NativeEnvelope = { version: 1, id, method, params, scope: scoped ? { ...this.scope! } : null };
    let timer: ReturnType<typeof setTimeout> | undefined;
    const cancelled = new Promise<never>((_, reject) => { this.pending.set(id, reject); });
    try {
      let nativeReply: Promise<unknown>;
      try { nativeReply = Promise.resolve(this.channel.postMessage(packet)); } catch (error) { nativeReply = Promise.reject(error); }
      const reply = record(await Promise.race([nativeReply, cancelled, new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new NativeBridgeError('timeout')), this.timeoutMs);
      })]));
      if (generation !== this.generation) throw new NativeBridgeError('scope_changed');
      if (reply.version !== 1 || reply.id !== id || typeof reply.ok !== 'boolean') throw new NativeBridgeError('invalid');
      if (!reply.ok) {
        const code = ['denied', 'expired', 'too_large', 'unavailable'].includes(String(reply.error)) ? String(reply.error) : 'invalid';
        throw new NativeBridgeError(code as 'denied' | 'expired' | 'too_large' | 'unavailable' | 'invalid');
      }
      return reply.value;
    } catch (error) {
      if (error instanceof NativeBridgeError) throw error;
      throw new NativeBridgeError('unavailable');
    } finally { this.pending.delete(id); if (timer !== undefined) clearTimeout(timer); }
  }
  async capabilities(): Promise<NativeCapabilities> {
    this.scopeInvalidationSupported = false;
    const value = record(await this.call('device.capabilities', {}, false));
    if (value.version !== 1 || value.origin !== this.origin || typeof value.keychain !== 'boolean' || typeof value.sharing !== 'boolean'
      || value.maxFileBytes !== NATIVE_SHARE_FILE_LIMIT || value.maxStorageBytes !== NATIVE_STORAGE_LIMIT) throw new NativeBridgeError('invalid');
    if (value.scopeInvalidationVersion !== 1) throw new NativeBridgeError('unsupported');
    this.scopeInvalidationSupported = true;
    return value as unknown as NativeCapabilities;
  }
  async authenticate(): Promise<void> {
    if (await this.call('device.authenticate', {}, false) !== true) throw new NativeBridgeError('denied');
  }
  async saveSnapshot(value: string, expiresAt: number): Promise<void> {
    const bytes = new TextEncoder().encode(value).byteLength;
    if (!bytes || bytes > NATIVE_STORAGE_LIMIT || !Number.isSafeInteger(expiresAt) || expiresAt <= this.now()
      || expiresAt > this.now() + 7 * 86400_000) throw new NativeBridgeError('too_large');
    if (await this.call('storage.save', { value, expiresAt }) !== true) throw new NativeBridgeError('invalid');
  }
  async readSnapshot(): Promise<string | null> {
    const value = await this.call('storage.read');
    if (value !== null && (typeof value !== 'string' || new TextEncoder().encode(value).byteLength > NATIVE_STORAGE_LIMIT)) throw new NativeBridgeError('invalid');
    return value as string | null;
  }
  async removeSnapshot(): Promise<void> {
    if (await this.call('storage.remove') !== true) throw new NativeBridgeError('invalid');
  }
  async pendingShare(): Promise<NativeShareMetadata | null> {
    const value = shareMetadata(await this.call('share.pending'));
    if (value && value.expiresAt <= this.now()) throw new NativeBridgeError('expired');
    return value;
  }
  async acceptShare(id: string): Promise<NativeSharedDraft> {
    const value = record(await this.call('share.accept', { id }));
    const meta = shareMetadata(value); if (!meta || meta.id !== id || meta.expiresAt <= this.now()) throw new NativeBridgeError('expired');
    if (typeof value.text !== 'string' || new TextEncoder().encode(value.text).byteLength > NATIVE_TEXT_LIMIT
      || typeof value.mime !== 'string' || typeof value.contentBase64 !== 'string') throw new NativeBridgeError('invalid');
    if (meta.kind === 'text') {
      if (value.mime !== 'text/plain' || value.contentBase64 !== '' || new TextEncoder().encode(value.text).byteLength !== meta.bytes) throw new NativeBridgeError('invalid');
    } else if (!['image/jpeg', 'image/png', 'text/plain', 'text/markdown', 'text/csv', 'application/pdf'].includes(value.mime)
      || value.contentBase64.length > 4 * Math.ceil(NATIVE_SHARE_FILE_LIMIT / 3)
      || value.contentBase64.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(value.contentBase64)
      || value.contentBase64.length / 4 * 3 - (value.contentBase64.endsWith('==') ? 2 : value.contentBase64.endsWith('=') ? 1 : 0) !== meta.bytes) {
      throw new NativeBridgeError('invalid');
    }
    return { ...meta, text: value.text, mime: value.mime, contentBase64: value.contentBase64 };
  }
  async cancelShare(id: string): Promise<void> {
    if (await this.call('share.cancel', { id }) !== true) throw new NativeBridgeError('invalid');
  }
  async finishShare(id: string): Promise<void> {
    if (await this.call('share.finish', { id }) !== true) throw new NativeBridgeError('invalid');
  }
}
