import { StorageError, type EncryptedPersistence, type StoreContents, type SealedEntry, type WrappedKey } from './types';

export const ENCRYPTED_DATABASE = 'hermes-remote-web.encrypted.v1';
const STORE = 'owned';
const CONTENTS_KEY = 'contents';

/** One owned database; no clearing of unrelated storage or conversation APIs. */
export class IndexedDbPersistence implements EncryptedPersistence {
  private database: Promise<IDBDatabase> | null = null;
  constructor(private readonly indexedDb: IDBFactory | undefined = globalThis.indexedDB) {}
  private open(): Promise<IDBDatabase> {
    if (!this.indexedDb) return Promise.reject(new StorageError('unavailable'));
    const indexedDb = this.indexedDb;
    this.database ??= new Promise((resolve, reject) => {
      const request = indexedDb.open(ENCRYPTED_DATABASE, 1);
      request.onupgradeneeded = () => { if (!request.result.objectStoreNames.contains(STORE)) request.result.createObjectStore(STORE); };
      request.onsuccess = () => { request.result.onversionchange = () => { request.result.close(); this.database = null; }; resolve(request.result); };
      request.onerror = () => { this.database = null; reject(new StorageError('unavailable')); };
      request.onblocked = () => { this.database = null; reject(new StorageError('unavailable')); };
    });
    return this.database;
  }
  async read(): Promise<StoreContents> {
    const database = await this.open();
    return new Promise((resolve, reject) => {
      const transaction = database.transaction(STORE, 'readonly');
      const request = transaction.objectStore(STORE).get(CONTENTS_KEY);
      request.onsuccess = () => { try { resolve(checkedContents(request.result)); } catch (error) { reject(error); } };
      request.onerror = () => reject(new StorageError('unavailable'));
    });
  }
  async change(update: (contents: StoreContents) => StoreContents): Promise<void> {
    const database = await this.open();
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(STORE, 'readwrite');
      const store = transaction.objectStore(STORE);
      const request = store.get(CONTENTS_KEY);
      let failure: unknown;
      request.onsuccess = () => {
        try { store.put(update(checkedContents(request.result)), CONTENTS_KEY); }
        catch (error) { failure = error; transaction.abort(); }
      };
      transaction.oncomplete = () => resolve();
      transaction.onerror = transaction.onabort = () => reject(failure || new StorageError('unavailable'));
    });
  }
}

function checkedContents(value: unknown): StoreContents {
  if (value === undefined || value === null) return { key: null, entries: [] };
  if (typeof value !== 'object' || !('entries' in value) || !Array.isArray(value.entries) || value.entries.length > 110) throw new StorageError('wrong_key');
  const key = 'key' in value && value.key && typeof value.key === 'object' && 'version' in value.key && value.key.version === 1
    ? value.key as WrappedKey : null;
  if (key && (Object.prototype.toString.call(key.salt) !== '[object Uint8Array]' || key.salt.byteLength !== 16 || Object.prototype.toString.call(key.iv) !== '[object Uint8Array]' || key.iv.byteLength !== 12 || Object.prototype.toString.call(key.ciphertext) !== '[object ArrayBuffer]' || key.ciphertext.byteLength !== 48)) throw new StorageError('wrong_key');
  return { key, entries: value.entries as SealedEntry[] };
}

/** Test adapter uses the same transaction interface; it is never selected in production. */
export class MemoryEncryptedPersistence implements EncryptedPersistence {
  contents: StoreContents = { key: null, entries: [] };
  async read(): Promise<StoreContents> { return structuredClone(this.contents); }
  async change(update: (contents: StoreContents) => StoreContents): Promise<void> { this.contents = structuredClone(update(structuredClone(this.contents))); }
}
