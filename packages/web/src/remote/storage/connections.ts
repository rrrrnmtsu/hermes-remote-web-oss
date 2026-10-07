export const CONNECTIONS_DATABASE = 'hermes-remote-web.connections.v1';
export const MAX_CONNECTIONS = 10;
export interface SavedConnection { origin: string; label: string }
export interface ConnectionPersistence { read(): Promise<SavedConnection[]>; write(connections: SavedConnection[]): Promise<void> }
export class ConnectionError extends Error { constructor() { super('接続先は資格情報・検索条件を含まないHTTPS originで指定してください。'); } }
export class ConnectionBoundaryError extends Error {
  constructor() { super('同じホストの別ポートや親子ホストは、認証Cookieの共有を避けるため開けません。別のホスト名を指定してください。'); }
}

/** Explicit navigation only: no cross-origin HTTP, ticket forwarding or proxy. */
export function connectionDestination(input: string, currentOrigin?: string): { origin: string; href: string } {
  if (input.length > 512 || [...input].some(character => character.charCodeAt(0) <= 32 || character === '\\')) throw new ConnectionError();
  let url: URL;
  try { url = new URL(input); } catch { throw new ConnectionError(); }
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash ||
    !['/', '/hermes-remote-web/', '/hermes-remote-web'].includes(url.pathname)) throw new ConnectionError();
  if (currentOrigin !== undefined) {
    let current: URL;
    try { current = new URL(currentOrigin); } catch { throw new ConnectionError(); }
    if (!['https:', 'http:'].includes(current.protocol) || current.username || current.password) throw new ConnectionError();
    const hostname = (value: URL): string => value.hostname.toLowerCase().replace(/\.$/, '');
    const sourceHost = hostname(current); const destinationHost = hostname(url);
    // Cookies are not port-isolated; reject obvious Domain-cookie parent/child overlap too.
    if (url.origin !== current.origin && (sourceHost === destinationHost || sourceHost.endsWith(`.${destinationHost}`) || destinationHost.endsWith(`.${sourceHost}`))) throw new ConnectionBoundaryError();
  }
  return { origin: url.origin, href: `${url.origin}/hermes-remote-web/` };
}
export class BrowserConnections {
  constructor(private readonly persistence: ConnectionPersistence = new IndexedDbConnections(),
    private readonly currentOrigin: () => string = () => window.location.origin) {}
  destination(connection: SavedConnection): { origin: string; href: string } {
    return connectionDestination(connection.origin, this.currentOrigin());
  }
  async list(): Promise<SavedConnection[]> {
    return (await this.persistence.read()).slice(0, MAX_CONNECTIONS).flatMap(connection => {
      try { return [{ origin: this.destination(connection).origin, label: cleanLabel(connection.label) }]; }
      catch { return []; }
    });
  }
  async add(originInput: string, label: string): Promise<void> {
    const origin = connectionDestination(originInput, this.currentOrigin()).origin;
    const current = await this.list();
    if (current.some(connection => connection.origin === origin)) throw new Error('この接続先は登録済みです。');
    if (current.length >= MAX_CONNECTIONS) throw new Error('接続先は最大10件です。');
    await this.persistence.write([...current, { origin, label: cleanLabel(label) || new URL(origin).hostname }]);
  }
  async remove(origin: string): Promise<void> { await this.persistence.write((await this.list()).filter(connection => connection.origin !== origin)); }
  async clear(): Promise<void> { await this.persistence.write([]); }
  open(connection: SavedConnection, navigate: (href: string) => void = href => window.location.assign(href)): void {
    navigate(this.destination(connection).href);
  }
}
function cleanLabel(label: string): string { return [...label].filter(character => character.charCodeAt(0) > 31 && character.charCodeAt(0) !== 127).join('').trim().slice(0, 80); }
class IndexedDbConnections implements ConnectionPersistence {
  private async database(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(CONNECTIONS_DATABASE, 1);
      request.onupgradeneeded = () => request.result.createObjectStore('origins');
      request.onsuccess = () => resolve(request.result);
      request.onerror = request.onblocked = () => reject(new Error('接続先一覧を端末へ保存できません。'));
    });
  }
  async read(): Promise<SavedConnection[]> {
    const database = await this.database();
    try {
      return await new Promise((resolve, reject) => {
        const request = database.transaction('origins', 'readonly').objectStore('origins').get('allowed');
        request.onsuccess = () => resolve(Array.isArray(request.result) ? request.result : []);
        request.onerror = () => reject(new Error('接続先一覧を読み込めません。'));
      });
    } finally { database.close(); }
  }
  async write(connections: SavedConnection[]): Promise<void> {
    const database = await this.database();
    try {
      await new Promise<void>((resolve, reject) => {
        const transaction = database.transaction('origins', 'readwrite');
        transaction.objectStore('origins').put(connections, 'allowed');
        transaction.oncomplete = () => resolve();
        transaction.onerror = transaction.onabort = () => reject(new Error('接続先一覧を保存できません。'));
      });
    } finally { database.close(); }
  }
}
