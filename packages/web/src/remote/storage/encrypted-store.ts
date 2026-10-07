import { IndexedDbPersistence } from './persistence';
import { StorageError, type EncryptedPersistence, type SavedEntry, type SealedEntry, type StorageKind, type StorageScope, type StoredHistory, type WrappedKey } from './types';

export const STORAGE_LIMITS = {
  draft: { ttl: 24 * 60 * 60 * 1000, count: 10, item: 64 * 1024, total: 1024 * 1024 },
  history: { ttl: 7 * 24 * 60 * 60 * 1000, count: 100, item: 20 * 1024 * 1024, total: 20 * 1024 * 1024 },
} as const;
const PBKDF2_ITERATIONS = 600_000;
const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', { fatal: true });
interface PlainEntry { version: 1; scope: StorageScope; value: string | StoredHistory }

/** AES-256-GCM with a random data key wrapped by PBKDF2-derived AES-256-GCM. */
export class BrowserEncryptedStore {
  private key: CryptoKey | null = null;
  private generation = 0;
  private scope: StorageScope | null = null;
  private preferences = { draft: false, history: false };
  private initialized = false;
  private pending: Promise<unknown> = Promise.resolve();
  constructor(
    readonly origin: string,
    private readonly persistence: EncryptedPersistence = new IndexedDbPersistence(),
    private readonly cryptography: Crypto = crypto,
    private readonly now: () => number = Date.now,
  ) {}
  get unlocked(): boolean { return this.key !== null; }
  get enabled(): Readonly<{ draft: boolean; history: boolean }> { return { ...this.preferences }; }
  get hasStorage(): boolean { return this.initialized; }
  async inspect(): Promise<void> {
    const contents = await this.persistence.read();
    this.initialized = contents.key !== null;
    this.preferences = { draft: contents.key?.draftEnabled === true, history: contents.key?.historyEnabled === true };
  }
  setScope(scope: StorageScope | null): void {
    if (this.scope && scope && this.scope.principal !== scope.principal) this.lock();
    if (!sameScope(this.scope, scope)) this.generation += 1;
    this.scope = scope ? checkedScope(scope, this.origin) : null;
  }
  lock(): void { this.generation += 1; this.key = null; this.scope = null; }
  async initialize(passphrase: string): Promise<void> {
    validatePassphrase(passphrase);
    const generation = this.generation;
    const raw = this.cryptography.getRandomValues(new Uint8Array(32));
    const salt = this.cryptography.getRandomValues(new Uint8Array(16));
    const iv = this.cryptography.getRandomValues(new Uint8Array(12));
    try {
      const wrapping = await this.wrappingKey(passphrase, salt);
      const ciphertext = await this.cryptography.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: this.keyAad() }, wrapping, raw);
      const key = await this.cryptography.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt']);
      if (generation !== this.generation) throw new StorageError('scope_changed');
      const wrapped: WrappedKey = { version: 1, salt, iv, ciphertext, draftEnabled: false, historyEnabled: false };
      await this.persistence.change(contents => {
        if (generation !== this.generation) throw new StorageError('scope_changed');
        if (contents.key) throw new StorageError('wrong_key');
        return { key: wrapped, entries: [] };
      });
      if (generation !== this.generation) throw new StorageError('scope_changed');
      this.key = key; this.initialized = true; this.preferences = { draft: false, history: false };
    } finally { raw.fill(0); }
  }
  async unlock(passphrase: string): Promise<void> {
    validatePassphrase(passphrase);
    const generation = this.generation;
    const contents = await this.persistence.read();
    if (!contents.key) throw new StorageError('not_found');
    let raw: Uint8Array<ArrayBuffer> | null = null;
    try {
      const wrapping = await this.wrappingKey(passphrase, contents.key.salt);
      raw = new Uint8Array(await this.cryptography.subtle.decrypt({ name: 'AES-GCM', iv: contents.key.iv, additionalData: this.keyAad() }, wrapping, contents.key.ciphertext));
      const key = await this.cryptography.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt']);
      if (generation !== this.generation) throw new StorageError('scope_changed');
      this.key = key; this.initialized = true;
      this.preferences = { draft: contents.key.draftEnabled, history: contents.key.historyEnabled };
      await this.pruneExpired();
    } catch (error) { if (error instanceof StorageError) throw error; throw new StorageError('wrong_key'); }
    finally { raw?.fill(0); }
  }
  async setEnabled(kind: StorageKind, value: boolean): Promise<void> {
    if (!this.key) throw new StorageError('locked');
    const generation = this.generation;
    await this.persistence.change(contents => {
      if (!contents.key) throw new StorageError('not_found');
      if (generation !== this.generation) throw new StorageError('scope_changed');
      return { key: { ...contents.key, [kind === 'draft' ? 'draftEnabled' : 'historyEnabled']: value }, entries: contents.entries };
    });
    this.preferences[kind] = value;
  }
  async saveDraft(scope: StorageScope, text: string): Promise<SavedEntry | null> {
    const generation = this.generation;
    return this.serialize(async () => {
      if (generation !== this.generation) throw new StorageError('scope_changed');
      const current = checkedScope(scope, this.origin);
      this.assertScope(current);
      if (!this.preferences.draft) throw new StorageError('disabled');
      const existing = await this.list('draft', current);
      if (!text) { for (const entry of existing) await this.remove(entry.id, current); return null; }
      if (encoder.encode(text).byteLength > STORAGE_LIMITS.draft.item) throw new StorageError('too_large');
      return this.save('draft', current, text, existing[0]?.id);
    });
  }
  async saveHistory(scope: StorageScope, history: StoredHistory): Promise<SavedEntry> {
    const generation = this.generation;
    return this.serialize(async () => {
      if (generation !== this.generation) throw new StorageError('scope_changed');
      const current = checkedScope(scope, this.origin);
      this.assertScope(current);
      if (!this.preferences.history) throw new StorageError('disabled');
      const snapshot = checkedHistory(history);
      if (encoder.encode(JSON.stringify(snapshot)).byteLength > STORAGE_LIMITS.history.item) throw new StorageError('too_large');
      return this.save('history', current, snapshot);
    });
  }
  async list(kind: StorageKind, scope: StorageScope): Promise<SavedEntry[]> {
    const current = checkedScope(scope, this.origin);
    const { key, generation } = this.assertScope(current);
    const contents = await this.persistence.read();
    const selected: SavedEntry[] = [];
    for (const entry of contents.entries) {
      if (entry.kind !== kind || entry.expiresAt <= this.now()) continue;
      try {
        const plain = await this.decrypt(entry, key);
        if (generation !== this.generation) throw new StorageError('scope_changed');
        if (sameScope(plain.scope, current)) selected.push(publicEntry(entry));
      } catch (error) { if (error instanceof StorageError && error.code === 'scope_changed') throw error; throw new StorageError('wrong_key'); }
    }
    if (generation !== this.generation) throw new StorageError('scope_changed');
    return selected.sort((left, right) => right.savedAt - left.savedAt);
  }
  async restoreDraft(scope: StorageScope, id: string): Promise<string> {
    const value = await this.read('draft', scope, id);
    if (typeof value !== 'string') throw new StorageError('wrong_key');
    return value;
  }
  async readHistory(scope: StorageScope, id: string): Promise<StoredHistory> {
    const value = await this.read('history', scope, id);
    if (typeof value === 'string') throw new StorageError('wrong_key');
    return checkedHistory(value);
  }
  /** Offline viewing is passphrase-gated; it cannot detect a remote revocation. */
  async listOfflineHistories(): Promise<Array<{ entry: SavedEntry; scope: StorageScope }>> {
    const key = this.key; const generation = this.generation;
    if (!key) throw new StorageError('locked');
    const saved: Array<{ entry: SavedEntry; scope: StorageScope }> = [];
    for (const entry of (await this.persistence.read()).entries) {
      if (entry.kind !== 'history' || entry.expiresAt <= this.now()) continue;
      const plain = await this.decrypt(entry, key);
      if (generation !== this.generation) throw new StorageError('scope_changed');
      const scope = checkedScope(plain.scope, this.origin);
      if (!this.scope || this.scope.principal === scope.principal) saved.push({ entry: publicEntry(entry), scope });
    }
    return saved.sort((left, right) => right.entry.savedAt - left.entry.savedAt);
  }
  async readOfflineHistory(id: string): Promise<{ scope: StorageScope; history: StoredHistory; entry: SavedEntry }> {
    const key = this.key; const generation = this.generation;
    if (!key) throw new StorageError('locked');
    const entry = (await this.persistence.read()).entries.find(value => value.kind === 'history' && value.id === id);
    if (!entry) throw new StorageError('not_found');
    if (entry.expiresAt <= this.now()) throw new StorageError('expired');
    const plain = await this.decrypt(entry, key);
    if (generation !== this.generation) throw new StorageError('scope_changed');
    const scope = checkedScope(plain.scope, this.origin);
    if (this.scope && this.scope.principal !== scope.principal) throw new StorageError('invalid_scope');
    if (typeof plain.value === 'string') throw new StorageError('wrong_key');
    return { scope, history: checkedHistory(plain.value), entry: publicEntry(entry) };
  }
  async removeOfflineHistory(id: string): Promise<void> {
    const generation = this.generation;
    await this.readOfflineHistory(id);
    await this.persistence.change(contents => {
      if (generation !== this.generation || !this.key) throw new StorageError('scope_changed');
      return { ...contents, entries: contents.entries.filter(entry => entry.id !== id || entry.kind !== 'history') };
    });
  }
  async remove(id: string, scope: StorageScope): Promise<void> {
    const current = checkedScope(scope, this.origin);
    const { key, generation } = this.assertScope(current);
    const found = (await this.persistence.read()).entries.find(entry => entry.id === id);
    if (!found) return;
    const plain = await this.decrypt(found, key);
    if (!sameScope(plain.scope, current)) throw new StorageError('invalid_scope');
    await this.persistence.change(contents => {
      if (generation !== this.generation) throw new StorageError('scope_changed');
      return { ...contents, entries: contents.entries.filter(entry => entry.id !== id) };
    });
  }
  /** User-confirmed logout/delete clears only this application's encrypted database. */
  async clearOwnData(): Promise<void> {
    this.lock(); this.preferences = { draft: false, history: false };
    await this.persistence.change(() => ({ key: null, entries: [] }));
    this.initialized = false;
  }
  async pruneExpired(): Promise<void> {
    const now = this.now();
    await this.persistence.change(contents => ({ ...contents, entries: contents.entries.filter(entry => entry.expiresAt > now) }));
  }
  private async read(kind: StorageKind, scope: StorageScope, id: string): Promise<string | StoredHistory> {
    const current = checkedScope(scope, this.origin);
    const { key, generation } = this.assertScope(current);
    const entry = (await this.persistence.read()).entries.find(candidate => candidate.id === id && candidate.kind === kind);
    if (!entry) throw new StorageError('not_found');
    if (entry.expiresAt <= this.now()) throw new StorageError('expired');
    const plain = await this.decrypt(entry, key);
    if (generation !== this.generation) throw new StorageError('scope_changed');
    if (!sameScope(plain.scope, current)) throw new StorageError('invalid_scope');
    return plain.value;
  }
  private async save(kind: StorageKind, scope: StorageScope, value: string | StoredHistory, existingId?: string): Promise<SavedEntry> {
    const { key, generation } = this.assertScope(scope);
    const savedAt = this.now();
    const expiresAt = savedAt + STORAGE_LIMITS[kind].ttl;
    const id = existingId || this.cryptography.randomUUID();
    const iv = this.cryptography.getRandomValues(new Uint8Array(12));
    const encoded = encoder.encode(JSON.stringify({ version: 1, scope, value } satisfies PlainEntry));
    let ciphertext: ArrayBuffer;
    try { ciphertext = await this.cryptography.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: this.entryAad(id, kind, savedAt, expiresAt) }, key, encoded); }
    finally { encoded.fill(0); }
    const entry: SealedEntry = { id, kind, iv, ciphertext, savedAt, expiresAt, bytes: ciphertext.byteLength + iv.byteLength };
    await this.persistence.change(contents => {
      if (generation !== this.generation || !this.key) throw new StorageError('scope_changed');
      if (!contents.key || !(kind === 'draft' ? contents.key.draftEnabled : contents.key.historyEnabled)) throw new StorageError('disabled');
      const remaining = contents.entries.filter(candidate => candidate.id !== id && candidate.expiresAt > savedAt);
      const sameKind = remaining.filter(candidate => candidate.kind === kind);
      if (sameKind.length >= STORAGE_LIMITS[kind].count || sameKind.reduce((sum, candidate) => sum + candidate.bytes, entry.bytes) > STORAGE_LIMITS[kind].total) throw new StorageError('quota');
      return { ...contents, entries: [...remaining, entry] };
    });
    return publicEntry(entry);
  }
  private assertScope(scope: StorageScope): { key: CryptoKey; generation: number } {
    if (!this.key) throw new StorageError('locked');
    if (!sameScope(this.scope, scope)) throw new StorageError('scope_changed');
    return { key: this.key, generation: this.generation };
  }
  private async decrypt(entry: SealedEntry, key: CryptoKey): Promise<PlainEntry> {
    if (!['draft', 'history'].includes(entry.kind) || Object.prototype.toString.call(entry.iv) !== '[object Uint8Array]' || entry.iv.byteLength !== 12 ||
      Object.prototype.toString.call(entry.ciphertext) !== '[object ArrayBuffer]' || entry.ciphertext.byteLength > STORAGE_LIMITS[entry.kind].item + 4096 ||
      entry.bytes !== entry.ciphertext.byteLength + entry.iv.byteLength || !Number.isFinite(entry.savedAt) || !Number.isFinite(entry.expiresAt)) throw new StorageError('wrong_key');
    let bytes: Uint8Array<ArrayBuffer>;
    try { bytes = new Uint8Array(await this.cryptography.subtle.decrypt({ name: 'AES-GCM', iv: entry.iv, additionalData: this.entryAad(entry.id, entry.kind, entry.savedAt, entry.expiresAt) }, key, entry.ciphertext)); }
    catch { throw new StorageError('wrong_key'); }
    try {
      const value: unknown = JSON.parse(decoder.decode(bytes));
      if (!value || typeof value !== 'object' || !('version' in value) || value.version !== 1 || !('scope' in value) || !('value' in value)) throw new StorageError('wrong_key');
      return value as PlainEntry;
    } finally { bytes.fill(0); }
  }
  private keyAad(): Uint8Array<ArrayBuffer> { return encoder.encode(`hermes-remote-web.encrypted.v1\n${this.origin}\nwrapped-key`); }
  private entryAad(id: string, kind: StorageKind, savedAt: number, expiresAt: number): Uint8Array<ArrayBuffer> { return encoder.encode(`hermes-remote-web.encrypted.v1\n${this.origin}\n${kind}\n${id}\n${savedAt}\n${expiresAt}`); }
  private async wrappingKey(passphrase: string, salt: Uint8Array<ArrayBuffer>): Promise<CryptoKey> {
    const bytes = encoder.encode(passphrase);
    try {
      const material = await this.cryptography.subtle.importKey('raw', bytes, 'PBKDF2', false, ['deriveKey']);
      return this.cryptography.subtle.deriveKey({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: PBKDF2_ITERATIONS }, material, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
    } finally { bytes.fill(0); }
  }
  private serialize<T>(action: () => Promise<T>): Promise<T> {
    const operation = this.pending.catch(() => undefined).then(action);
    this.pending = operation; return operation;
  }
}

export function sameScope(left: StorageScope | null, right: StorageScope | null): boolean {
  return left === right || !!left && !!right && left.origin === right.origin && left.principal === right.principal && left.profile === right.profile && left.durableSession === right.durableSession;
}
function checkedScope(scope: StorageScope, origin: string): StorageScope {
  if (scope.origin !== origin || !scope.principal || !scope.profile || !scope.durableSession || Object.values(scope).some(value => typeof value !== 'string' || value.length > 512)) throw new StorageError('invalid_scope');
  return { origin, principal: scope.principal, profile: scope.profile, durableSession: scope.durableSession };
}
function validatePassphrase(value: string): void { if (value.length < 12 || value.length > 256) throw new StorageError('invalid_passphrase'); }
function publicEntry(entry: SealedEntry): SavedEntry { return { id: entry.id, kind: entry.kind, savedAt: entry.savedAt, expiresAt: entry.expiresAt, bytes: entry.bytes }; }
function checkedHistory(value: StoredHistory): StoredHistory {
  if (!Array.isArray(value.messages) || value.messages.length > 2_000 || !Number.isFinite(value.syncedAt)) throw new StorageError('too_large');
  return { messages: value.messages.map(message => {
    if ((message.role !== 'user' && message.role !== 'assistant') || typeof message.text !== 'string') throw new StorageError('invalid_scope');
    return { role: message.role, text: message.text };
  }), syncedAt: value.syncedAt, limited: value.limited === true, partial: value.partial === true };
}
