import { webcrypto } from 'node:crypto';
import { beforeAll, describe, expect, it } from 'vitest';
import { BrowserEncryptedStore, STORAGE_LIMITS } from './encrypted-store';
import { MemoryEncryptedPersistence } from './persistence';
import type { StoreContents, StorageScope, StoredHistory } from './types';

const crypto = webcrypto as unknown as Crypto;
const origin = 'https://DEMO.example';
const passphrase = 'DEMO-local-passphrase-only';
const scope: StorageScope = { origin, principal: 'DEMO-principal', profile: 'DEMO-profile', durableSession: 'DEMO-session' };
const history: StoredHistory = { messages: [{ role: 'user', text: 'DEMO 日本語\n```text\n秘密になり得る本文\n```' }, { role: 'assistant', text: '<script>DEMO</script>' }], syncedAt: 1_000, limited: true, partial: false };
let initial: StoreContents;
beforeAll(async () => {
  const persistence = new MemoryEncryptedPersistence();
  const store = new BrowserEncryptedStore(origin, persistence, crypto, () => 1_000);
  await store.initialize(passphrase); initial = await persistence.read();
});
async function prepare(now: () => number = () => 1_000) {
  const persistence = new MemoryEncryptedPersistence(); persistence.contents = structuredClone(initial);
  const store = new BrowserEncryptedStore(origin, persistence, crypto, now);
  await store.unlock(passphrase); store.setScope(scope);
  return { store, persistence };
}
describe('opt-in scoped encrypted draft and offline history storage', () => {
  it('keeps both features OFF by default and never writes a draft/history without consent', async () => {
    const { store, persistence } = await prepare();
    expect(store.enabled).toEqual({ draft: false, history: false });
    await expect(store.saveDraft(scope, 'DEMO private')).rejects.toMatchObject({ code: 'disabled' });
    await expect(store.saveHistory(scope, history)).rejects.toMatchObject({ code: 'disabled' });
    expect(persistence.contents.entries).toHaveLength(0);
  });
  it('restores after reload/offline using only a passphrase-wrapped key, and persists no clear scope or text', async () => {
    const { store, persistence } = await prepare();
    await store.setEnabled('draft', true); await store.setEnabled('history', true);
    const draft = await store.saveDraft(scope, 'DEMO 日本語\n未送信');
    const saved = await store.saveHistory(scope, history);
    const encodedStore = JSON.stringify(persistence.contents);
    for (const secret of [passphrase, scope.principal, scope.profile, scope.durableSession, '未送信', '秘密になり得る']) expect(encodedStore).not.toContain(secret);
    expect(persistence.contents.entries.every(entry => entry.iv.byteLength === 12 && entry.ciphertext.byteLength > 16)).toBe(true);
    store.lock();
    const reloaded = new BrowserEncryptedStore(origin, persistence, crypto, () => 1_001);
    await reloaded.unlock(passphrase); reloaded.setScope(scope);
    expect(await reloaded.restoreDraft(scope, draft!.id)).toBe('DEMO 日本語\n未送信');
    expect(await reloaded.readHistory(scope, saved.id)).toEqual(history);
    reloaded.setScope(null);
    expect((await reloaded.listOfflineHistories())[0]?.scope).toEqual(scope);
    expect((await reloaded.readOfflineHistory(saved.id)).history.messages[0]?.text).toContain('日本語');
  });
  it('rejects wrong passphrase and ciphertext moved to a second origin without a provider or auth request', async () => {
    const { persistence } = await prepare();
    await expect(new BrowserEncryptedStore(origin, persistence, crypto).unlock('DEMO-wrong-passphrase')).rejects.toMatchObject({ code: 'wrong_key' });
    await expect(new BrowserEncryptedStore('https://other.example', persistence, crypto).unlock(passphrase)).rejects.toMatchObject({ code: 'wrong_key' });
  });
  it('isolates profile/durable session/principal and destroys the in-memory key on principal change', async () => {
    const { store } = await prepare(); await store.setEnabled('draft', true);
    const draft = await store.saveDraft(scope, 'DEMO this scope');
    const otherProfile = { ...scope, profile: 'DEMO-other' }; store.setScope(otherProfile);
    expect(await store.list('draft', otherProfile)).toEqual([]);
    await expect(store.restoreDraft(otherProfile, draft!.id)).rejects.toMatchObject({ code: 'invalid_scope' });
    const otherSession = { ...scope, durableSession: 'DEMO-other' }; store.setScope(otherSession);
    expect(await store.list('draft', otherSession)).toEqual([]);
    store.setScope({ ...scope, principal: 'DEMO-other-user' }); expect(store.unlocked).toBe(false);
    await expect(store.restoreDraft(scope, draft!.id)).rejects.toMatchObject({ code: 'locked' });
  });
  it('bounds draft UTF-8 bytes and count across scopes, replaces only the same scoped draft, and does not erase on quota failure', async () => {
    const { store, persistence } = await prepare(); await store.setEnabled('draft', true);
    await expect(store.saveDraft(scope, '日'.repeat(Math.floor(STORAGE_LIMITS.draft.item / 3) + 1))).rejects.toMatchObject({ code: 'too_large' });
    const first = await store.saveDraft(scope, 'DEMO first'); const revised = await store.saveDraft(scope, 'DEMO revised');
    expect(revised?.id).toBe(first?.id); expect(persistence.contents.entries).toHaveLength(1);
    for (let index = 1; index < 10; index += 1) { const another = { ...scope, durableSession: `DEMO-${index}` }; store.setScope(another); await store.saveDraft(another, 'DEMO'); }
    const extra = { ...scope, durableSession: 'DEMO-over-limit' }; store.setScope(extra);
    await expect(store.saveDraft(extra, 'DEMO')).rejects.toMatchObject({ code: 'quota' });
    expect(persistence.contents.entries).toHaveLength(10);
    store.setScope(scope); expect(await store.restoreDraft(scope, first!.id)).toBe('DEMO revised');
  });
  it('bounds 20MiB history and preserves all accepted data when capacity fails', async () => {
    const { store, persistence } = await prepare(); await store.setEnabled('history', true);
    const text = 'x'.repeat(11 * 1024 * 1024);
    await store.saveHistory(scope, { ...history, messages: [{ role: 'assistant', text }] });
    await expect(store.saveHistory(scope, { ...history, messages: [{ role: 'assistant', text }] })).rejects.toMatchObject({ code: 'quota' });
    expect(persistence.contents.entries).toHaveLength(1);
    await expect(store.saveHistory(scope, { ...history, messages: [{ role: 'assistant', text: 'x'.repeat(20 * 1024 * 1024 + 1) }] })).rejects.toMatchObject({ code: 'too_large' });
  });
  it('expires only explicit app-owned records and reports expiry without treating it as an empty server queue', async () => {
    let now = 1_000; const { store, persistence } = await prepare(() => now);
    await store.setEnabled('draft', true); await store.setEnabled('history', true);
    const draft = await store.saveDraft(scope, 'DEMO'); const saved = await store.saveHistory(scope, history);
    now += STORAGE_LIMITS.draft.ttl + 1;
    await expect(store.restoreDraft(scope, draft!.id)).rejects.toMatchObject({ code: 'expired' });
    expect((await store.readHistory(scope, saved.id)).messages).toHaveLength(2);
    await store.pruneExpired(); expect(persistence.contents.entries).toHaveLength(1);
    now += STORAGE_LIMITS.history.ttl; await store.pruneExpired(); expect(persistence.contents.entries).toHaveLength(0);
  });
  it('refuses authenticated-ciphertext or expiry metadata tampering instead of showing a successful restoration', async () => {
    const { store, persistence } = await prepare(); await store.setEnabled('draft', true);
    const draft = await store.saveDraft(scope, 'DEMO private');
    const entry = persistence.contents.entries[0]!; entry.expiresAt += 100;
    await expect(store.restoreDraft(scope, draft!.id)).rejects.toMatchObject({ code: 'wrong_key' });
    await expect(store.list('draft', scope)).rejects.toMatchObject({ code: 'wrong_key' });
  });
  it('invalidates a save in progress on scope change, without writing the former draft into the new conversation', async () => {
    const { store, persistence } = await prepare(); await store.setEnabled('draft', true);
    const pending = store.saveDraft(scope, 'DEMO queued old draft'); store.setScope({ ...scope, durableSession: 'DEMO-other' });
    await expect(pending).rejects.toMatchObject({ code: 'scope_changed' }); expect(persistence.contents.entries).toHaveLength(0);
  });
  it('locks on logout, erases only owned ciphertext, and OFF storage remains empty afterward', async () => {
    const { store, persistence } = await prepare(); await store.setEnabled('draft', true); await store.saveDraft(scope, 'DEMO private');
    await store.clearOwnData(); expect(store.unlocked).toBe(false); expect(store.enabled).toEqual({ draft: false, history: false });
    expect(persistence.contents).toEqual({ key: null, entries: [] });
    await expect(store.unlock(passphrase)).rejects.toMatchObject({ code: 'not_found' });
  });
  it('propagates storage failure without silently dropping the memory draft or claiming it was saved', async () => {
    const { store, persistence } = await prepare(); await store.setEnabled('draft', true);
    persistence.change = async () => { throw new Error('DEMO quota denied'); };
    await expect(store.saveDraft(scope, 'DEMO remains in composer')).rejects.toThrow('DEMO quota denied');
    expect(persistence.contents.entries).toHaveLength(0);
  });
  it('does not accept system/tool data as an offline snapshot', async () => {
    const { store } = await prepare(); await store.setEnabled('history', true);
    await expect(store.saveHistory(scope, { ...history, messages: [{ role: 'system' as 'user', text: 'DEMO system secret' }] })).rejects.toMatchObject({ code: 'invalid_scope' });
  });
});
