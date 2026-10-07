import { describe, expect, it, vi } from 'vitest';
import { BrowserConnections, connectionDestination, type SavedConnection } from './connections';

describe('explicit origin-isolated connection navigation', () => {
  it('normalizes approved HTTPS origins to the fixed same-origin app path', () => {
    expect(connectionDestination('https://DEMO.example:9443')).toEqual({ origin: 'https://demo.example:9443', href: 'https://demo.example:9443/hermes-remote-web/' });
    expect(connectionDestination('https://demo.example/hermes-remote-web/').href).toBe('https://demo.example/hermes-remote-web/');
  });
  it('rejects embedded credentials, insecure/custom protocols, query tickets, fragments and arbitrary paths', () => {
    for (const url of ['http://demo.example', 'javascript:alert(1)', 'https://user:secret@demo.example', 'https://demo.example/?ticket=DEMO', 'https://demo.example/#secret', 'https://demo.example/api/', 'https://demo.example/../api/', 'https://demo.example\\@other.example', '//demo.example']) expect(() => connectionDestination(url)).toThrow();
  });
  it('refuses another origin on the same canonical host, including default ports and host aliases', () => {
    for (const target of ['https://DEMO.example:9444', 'https://demo.example', 'https://demo.example.:9444']) {
      expect(() => connectionDestination(target, 'https://demo.example:9443')).toThrow('同じホスト');
    }
    expect(() => connectionDestination('https://2130706433:9444', 'https://127.0.0.1:9443')).toThrow('同じホスト');
    expect(connectionDestination('https://demo.example:443', 'https://demo.example').origin).toBe('https://demo.example');
    expect(connectionDestination('https://localhost:9444', 'https://127.0.0.1:9443').origin).toBe('https://localhost:9444');
  });
  it('refuses parent/child cookie-domain overlap but allows independent hostnames', () => {
    expect(() => connectionDestination('https://example.test', 'https://child.example.test')).toThrow('親子ホスト');
    expect(() => connectionDestination('https://child.example.test', 'https://example.test')).toThrow('親子ホスト');
    expect(() => connectionDestination('https://deep.child.example.test', 'https://example.test')).toThrow('親子ホスト');
    expect(connectionDestination('https://independent.example.test', 'https://other.example.test').origin).toBe('https://independent.example.test');
    expect(connectionDestination('https://notexample.test', 'https://example.test').origin).toBe('https://notexample.test');
    expect(() => connectionDestination('https://other.example.test', 'null')).toThrow();
  });
  it('keeps each origin storage independent, stores only explicit metadata and never fetches another origin', async () => {
    let first: SavedConnection[] = []; let second: SavedConnection[] = [];
    const a = new BrowserConnections({ read: async () => first, write: async entries => { first = entries; } });
    const b = new BrowserConnections({ read: async () => second, write: async entries => { second = entries; } });
    await a.add('https://one.example:9443', 'DEMO one'); await b.add('https://two.example:9443', 'DEMO two');
    expect(await a.list()).toEqual([{ origin: 'https://one.example:9443', label: 'DEMO one' }]);
    expect(await b.list()).toEqual([{ origin: 'https://two.example:9443', label: 'DEMO two' }]);
    const navigate = vi.fn(); const request = vi.spyOn(globalThis, 'fetch');
    a.open((await a.list())[0]!, navigate);
    expect(navigate).toHaveBeenCalledTimes(1); expect(navigate).toHaveBeenCalledWith('https://one.example:9443/hermes-remote-web/');
    expect(request).not.toHaveBeenCalled(); request.mockRestore();
    await a.clear(); expect(await a.list()).toEqual([]); expect(await b.list()).toHaveLength(1);
  });
  it('rejects duplicates and bounds explicit connection registration to ten', async () => {
    let entries: SavedConnection[] = [];
    const connections = new BrowserConnections({ read: async () => entries, write: async items => { entries = items; } });
    await connections.add('https://one.example', 'DEMO'); await expect(connections.add('https://one.example/', 'again')).rejects.toThrow('登録済み');
    for (let index = 1; index < 10; index += 1) await connections.add(`https://DEMO-${index}.example`, 'DEMO');
    await expect(connections.add('https://overflow.example', 'DEMO')).rejects.toThrow('最大10');
    await connections.remove('https://one.example'); expect(await connections.list()).toHaveLength(9);
  });
  it('rejects forbidden registration before any persistence write and filters unsafe legacy entries without clearing them', async () => {
    const entries: SavedConnection[] = [
      { origin: 'https://demo.example:9444', label: 'DEMO old alternate port' },
      { origin: 'https://child.demo.example', label: 'DEMO old child' },
      { origin: 'https://other.example', label: 'DEMO permitted' },
    ];
    const write = vi.fn(); const connections = new BrowserConnections({ read: async () => entries, write }, () => 'https://demo.example:9443');
    await expect(connections.add('https://demo.example:9444', 'DEMO')).rejects.toThrow('同じホスト');
    expect(await connections.list()).toEqual([entries[2]]); expect(entries).toHaveLength(3); expect(write).not.toHaveBeenCalled();
    const navigate = vi.fn(); expect(() => connections.open(entries[0]!, navigate)).toThrow('同じホスト');
    expect(navigate).not.toHaveBeenCalled(); expect(write).not.toHaveBeenCalled();
  });
  it('rechecks current browser origin at final open instead of trusting an earlier listing', async () => {
    const destination = { origin: 'https://other.example:9444', label: 'DEMO destination' };
    let currentOrigin = 'https://original.example:9443';
    const connections = new BrowserConnections({ read: async () => [destination], write: vi.fn() }, () => currentOrigin);
    expect(await connections.list()).toEqual([destination]);
    currentOrigin = 'https://other.example:9443'; const navigate = vi.fn();
    expect(() => connections.open(destination, navigate)).toThrow('同じホスト'); expect(navigate).not.toHaveBeenCalled();
  });
});
