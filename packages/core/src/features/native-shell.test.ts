import { afterEach, describe, expect, it, vi } from 'vitest';
import { NativeShellClient, nativeApprovedOrigin, NATIVE_SHARE_FILE_LIMIT, NATIVE_STORAGE_LIMIT,
  type NativeChannel, type NativeEnvelope, type NativeScope } from './native-shell';

const origin = 'https://hermes.example.invalid:9443';
const scope: NativeScope = { origin, principal: 'DEMO-owner', profile: 'DEMO-profile', durableSession: 'DEMO-durable' };
const id = '12345678-1234-1234-1234-123456789abc';
const share = { id, kind: 'text', name: '共有テキスト', bytes: 18, expiresAt: 2000, text: '日本語の共有', mime: 'text/plain', contentBase64: '' };
const capabilities = { version: 1, origin, scopeInvalidationVersion: 1, keychain: true, sharing: true, maxFileBytes: NATIVE_SHARE_FILE_LIMIT, maxStorageBytes: NATIVE_STORAGE_LIMIT };
function fixture(value: unknown = true) {
  const channel: NativeChannel = { postMessage: vi.fn(async (packet: NativeEnvelope) => ({ version: 1, id: packet.id, ok: true,
    value: packet.method === 'device.capabilities' ? typeof value === 'object' && value !== null && 'version' in value ? value : capabilities : value })) };
  const client = new NativeShellClient(origin, channel, () => 1000); client.setScope(scope);
  return { client, channel };
}
async function enableNative(client: NativeShellClient, channel: NativeChannel): Promise<void> {
  await client.capabilities(); vi.mocked(channel.postMessage).mockClear();
}
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

describe('native bridge scoped explicit operations', () => {
  it.each(['http://hermes.example.invalid', 'https://user:password@hermes.example.invalid', `${origin}/hermes-remote-web/`, `${origin}?ticket=DEMO`, `${origin}#data`, 'https://OTHER.example.invalid'])('refuses unapproved/carrying-data origin %s', value => {
    expect(() => nativeApprovedOrigin(value)).toThrow();
  });
  it('supports only canonical HTTPS metadata and keeps capability separate from Hermes auth', async () => {
    const { client, channel } = fixture(capabilities);
    expect(await client.capabilities()).toMatchObject({ keychain: true });
    expect(channel.postMessage).toHaveBeenCalledWith(expect.objectContaining({ method: 'device.capabilities', scope: null }));
    const unknown = fixture({ version: 2, origin }); await expect(unknown.client.capabilities()).rejects.toThrow('invalid');
    client.setScope(null); await expect(client.pendingShare()).rejects.toThrow('denied');
  });
  it('calls no channel on setup and invalidates scopes using only empty native controls', () => {
    const { client, channel } = fixture(); expect(channel.postMessage).not.toHaveBeenCalled();
    client.setScope({ ...scope, profile: 'another' }); client.invalidate();
    expect(vi.mocked(channel.postMessage).mock.calls.map(([packet]) => packet.method)).toEqual(['device.invalidate', 'device.invalidate']);
    for (const [packet] of vi.mocked(channel.postMessage).mock.calls) expect(packet).toMatchObject({ version: 1, scope: null, params: {} });
  });
  it('rejects late secure reads after profile/principal/session changes', async () => {
    const { client, channel } = fixture(); await enableNative(client, channel); let resolve!: (value: unknown) => void;
    vi.mocked(channel.postMessage).mockImplementation(packet => new Promise(done => { resolve = value => done({ version: 1, id: packet.id, ok: true, value }); }));
    const pending = client.readSnapshot(); client.setScope({ ...scope, durableSession: 'other' }); resolve('DEMO-old-snapshot');
    await expect(pending).rejects.toThrow('scope_changed'); expect(channel.postMessage).toHaveBeenCalledTimes(2);
  });
  it('checks storage bytes/expiry before writes and never persists values itself', async () => {
    const storage = vi.spyOn(Storage.prototype, 'setItem'); const { client, channel } = fixture();
    await enableNative(client, channel);
    await client.saveSnapshot('合成の下書き', 2000);
    expect(channel.postMessage).toHaveBeenCalledWith(expect.objectContaining({ method: 'storage.save', scope, params: { value: '合成の下書き', expiresAt: 2000 } }));
    await expect(client.saveSnapshot('あ'.repeat(NATIVE_STORAGE_LIMIT), 2000)).rejects.toThrow('too_large');
    await expect(client.saveSnapshot('text', 999)).rejects.toThrow('too_large');
    expect(channel.postMessage).toHaveBeenCalledTimes(1); expect(storage).not.toHaveBeenCalled();
  });
  it('does not fetch contents during pending metadata inspection or automatically finish/send', async () => {
    const { client, channel } = fixture(share); await enableNative(client, channel); const meta = await client.pendingShare();
    expect(meta).not.toHaveProperty('text'); expect(meta).not.toHaveProperty('contentBase64');
    const accepted = await client.acceptShare(id); expect(accepted.text).toBe(share.text);
    expect(vi.mocked(channel.postMessage).mock.calls.map(call => call[0].method)).toEqual(['share.pending', 'share.accept']);
    await client.finishShare(id).catch(() => undefined); // A malformed finish receipt is rejected, never retried.
    expect(channel.postMessage).toHaveBeenCalledTimes(3);
  });
  it('rejects wrong/expired share, unsupported MIME and deceptive capacity', async () => {
    const expired = fixture({ ...share, expiresAt: 900 }); await enableNative(expired.client, expired.channel); await expect(expired.client.pendingShare()).rejects.toThrow('expired');
    const mismatch = fixture({ ...share, bytes: 17 }); await enableNative(mismatch.client, mismatch.channel); await expect(mismatch.client.acceptShare(id)).rejects.toThrow('invalid');
    const file = fixture({ ...share, kind: 'file', name: 'fake.svg', bytes: 3, text: '説明', contentBase64: 'YWJj', mime: 'image/svg+xml' });
    await enableNative(file.client, file.channel); await expect(file.client.acceptShare(id)).rejects.toThrow('invalid');
    const bad = fixture({ ...share, kind: 'file', name: 'demo.txt', bytes: 4, text: '説明', contentBase64: 'YWJj', mime: 'text/plain' });
    await enableNative(bad.client, bad.channel); await expect(bad.client.acceptShare(id)).rejects.toThrow('invalid');
  });
  it('keeps file bytes as a bounded memory payload and does not permit a phone/server path', async () => {
    const { client, channel } = fixture({ ...share, kind: 'file', name: 'synthetic.txt', bytes: 3, text: '説明', contentBase64: 'YWJj', mime: 'text/plain' });
    await enableNative(client, channel);
    expect((await client.acceptShare(id)).contentBase64).toBe('YWJj');
    const unsafe = fixture({ ...share, name: '../secret.txt' }); await enableNative(unsafe.client, unsafe.channel); await expect(unsafe.client.pendingShare()).rejects.toThrow('invalid');
  });
  it('does not automatically retry an unknown native operation', async () => {
    vi.useFakeTimers(); const channel: NativeChannel = { postMessage: vi.fn(packet => packet.method === 'device.capabilities'
      ? Promise.resolve({ version: 1, id: packet.id, ok: true, value: capabilities }) : new Promise(() => undefined)) };
    const client = new NativeShellClient(origin, channel, () => 1000, 50); client.setScope(scope);
    await enableNative(client, channel);
    const action = client.saveSnapshot('合成', 2000); const rejection = expect(action).rejects.toThrow('timeout');
    await vi.advanceTimersByTimeAsync(51); await rejection;
    expect(channel.postMessage).toHaveBeenCalledTimes(1);
  });
  it('checks reply ID and maps only sanitized fixed error codes', async () => {
    const { client, channel } = fixture(); vi.mocked(channel.postMessage).mockResolvedValue({ version: 1, id: 'another', ok: true, value: true });
    await expect(client.authenticate()).rejects.toThrow('invalid');
    vi.mocked(channel.postMessage).mockImplementation(async packet => ({ version: 1, id: packet.id, ok: false, error: 'sensitive-native-path' }));
    await expect(client.authenticate()).rejects.toThrow('invalid');
  });
  it('does not expose native channel exception details or retry', async () => {
    const { client, channel } = fixture(); await enableNative(client, channel); vi.mocked(channel.postMessage).mockRejectedValue(new Error('DEMO-private-path-or-keychain-detail'));
    await expect(client.readSnapshot()).rejects.toThrow('unavailable');
    expect(channel.postMessage).toHaveBeenCalledTimes(1);
  });
  it('rejects a waiting native action immediately and ignores late invalidation ACK for a new scope', async () => {
    let controlAck!: (value: unknown) => void;
    const channel: NativeChannel = { postMessage: vi.fn(packet => {
      if (packet.method === 'device.capabilities') return Promise.resolve({ version: 1, id: packet.id, ok: true, value: capabilities });
      if (packet.method === 'storage.read') return new Promise(() => undefined);
      if (packet.method === 'device.invalidate') return new Promise(resolve => { controlAck = value => resolve({ version: 1, id: packet.id, ok: true, value }); });
      return Promise.resolve({ version: 1, id: packet.id, ok: true, value: true });
    }) };
    const client = new NativeShellClient(origin, channel, () => 1000); client.setScope(scope);
    await enableNative(client, channel);
    const action = client.readSnapshot(); const rejected = expect(action).rejects.toThrow('scope_changed');
    client.invalidate(); await rejected;
    const nextScope = { ...scope, profile: 'DEMO-new-profile' }; client.setScope(nextScope);
    controlAck(true); await Promise.resolve();
    await client.saveSnapshot('合成の新しい下書き', 2000);
    const packets = vi.mocked(channel.postMessage).mock.calls.map(([packet]) => packet);
    expect(packets.map(packet => packet.method)).toEqual(['storage.read', 'device.invalidate', 'storage.save']);
    expect(packets[1]).toEqual({ version: 1, id: expect.stringMatching(/^native-\d+$/), method: 'device.invalidate', scope: null, params: {} });
    expect(packets[2]!.scope).toEqual(nextScope);
  });
  it('keeps local invalidation final when native control fails or remains unknown, with zero retries', async () => {
    const channel: NativeChannel = { postMessage: vi.fn(packet => packet.method === 'device.capabilities'
      ? Promise.resolve({ version: 1, id: packet.id, ok: true, value: capabilities }) : packet.method === 'device.invalidate'
        ? Promise.reject(new Error('DEMO-private-control-error')) : new Promise(() => undefined)) };
    const client = new NativeShellClient(origin, channel, () => 1000); client.setScope(scope);
    await enableNative(client, channel);
    const action = client.finishShare(id); const rejected = expect(action).rejects.toThrow('scope_changed');
    client.invalidate(); await rejected; await Promise.resolve();
    await expect(client.pendingShare()).rejects.toThrow('denied');
    expect(vi.mocked(channel.postMessage).mock.calls.map(([packet]) => packet.method)).toEqual(['share.finish', 'device.invalidate']);
  });
  it('invalidates a queued fixture removal before the native action and performs no storage mutation', async () => {
    let nativeEpoch = 0; let release!: () => void; let removals = 0;
    const channel: NativeChannel = { postMessage: vi.fn(packet => {
      if (packet.method === 'device.capabilities') return Promise.resolve({ version: 1, id: packet.id, ok: true, value: capabilities });
      if (packet.method === 'device.invalidate') { nativeEpoch++; return Promise.resolve({ version: 1, id: packet.id, ok: true, value: true }); }
      const captured = nativeEpoch;
      return new Promise(resolve => { release = () => {
        if (captured === nativeEpoch) removals++;
        resolve({ version: 1, id: packet.id, ok: captured === nativeEpoch, error: 'denied', value: true });
      }; });
    }) };
    const client = new NativeShellClient(origin, channel, () => 1000); client.setScope(scope);
    await enableNative(client, channel);
    const action = client.removeSnapshot(); const rejected = expect(action).rejects.toThrow('scope_changed');
    client.invalidate(); await rejected; release(); await Promise.resolve();
    expect(removals).toBe(0);
    expect(vi.mocked(channel.postMessage).mock.calls.map(([packet]) => packet.method)).toEqual(['storage.remove', 'device.invalidate']);
  });
  it.each([undefined, 0, 2, '1'])('refuses storage/share on an old or unverified shell capability %s', async version => {
    const { client, channel } = fixture({ ...capabilities, scopeInvalidationVersion: version });
    await expect(client.readSnapshot()).rejects.toThrow('unsupported'); expect(channel.postMessage).not.toHaveBeenCalled();
    await expect(client.capabilities()).rejects.toThrow('unsupported');
    await expect(client.saveSnapshot('合成', 2000)).rejects.toThrow('unsupported');
    await expect(client.pendingShare()).rejects.toThrow('unsupported');
    await expect(client.acceptShare(id)).rejects.toThrow('unsupported');
    await expect(client.finishShare(id)).rejects.toThrow('unsupported');
    expect(vi.mocked(channel.postMessage).mock.calls.map(([packet]) => packet.method)).toEqual(['device.capabilities']);
  });
});
