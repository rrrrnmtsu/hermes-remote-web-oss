import assert from 'node:assert/strict';
import { readFileSync, readlinkSync } from 'node:fs';
import { networkInterfaces } from 'node:os';
import { createConnection } from 'node:net';
import { createHash } from 'node:crypto';

/** Observe the kernel boundary before allowing a non-intercepted worker test. */
export async function observeWorkerNetworkIsolation() {
  assert.equal(process.env.HERMES_TEST_WORKER_NETWORK_ISOLATED, '1', 'The isolated worker runner is required');
  assert.equal(process.platform, 'linux');
  const interfaces = networkInterfaces();
  assert.deepEqual(Object.keys(interfaces), ['lo'], 'An isolation flag cannot authorize a host network');
  assert.ok(interfaces.lo.length > 0 && interfaces.lo.every(address => address.internal));
  const ipv4Routes = readFileSync('/proc/net/route', 'utf8').trim().split('\n').slice(1);
  assert.equal(ipv4Routes.length, 0, 'An IPv4 route is outside the disposable fixture boundary');
  const ipv6Routes = readFileSync('/proc/net/ipv6_route', 'utf8').trim().split('\n').filter(Boolean);
  assert.ok(ipv6Routes.every(line => line.trim().split(/\s+/).at(-1) === 'lo'), 'An IPv6 route is outside the disposable fixture boundary');
  const probes = [];
  // Documentation-only addresses cannot be a provider; the kernel must reject
  // them without routing a packet. No DNS, credentials or request data is used.
  for (const host of ['192.0.2.1', '2001:db8::1']) {
    const code = await new Promise((resolve, reject) => {
      const socket = createConnection({ host, port: 443 });
      socket.once('connect', () => { socket.destroy(); reject(new Error('Fixture network isolation was not effective')); });
      socket.once('error', error => { socket.destroy(); resolve(error.code); });
      socket.setTimeout(3000, () => { socket.destroy(); reject(new Error('Fixture network isolation observation timed out')); });
    });
    assert.ok(code === 'ENETUNREACH' || host.includes(':') && code === 'EAFNOSUPPORT', 'An external connection was not rejected by the kernel');
    probes.push({ family: host.includes(':') ? 6 : 4, result: code });
  }
  return { boundary: 'DISPOSABLE_LOOPBACK_ONLY_KERNEL_NETWORK_NAMESPACE',
    namespaceSha256: createHash('sha256').update(readlinkSync('/proc/self/ns/net')).digest('hex'),
    interfaceCount: 1, nonLoopbackInterfaces: 0, ipv4Routes: 0, nonLoopbackIPv6Routes: 0, externalConnectionProbes: probes,
    playwrightRequestInterception: false, hostNetworkMutation: 0 };
}
