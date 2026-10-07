import assert from 'node:assert/strict';
import { spawnSync, execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { networkInterfaces } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
import { chromium } from 'playwright';

// A disposable kernel network namespace owns the fixture and every browser.
// There is no route to production/providers and no Playwright interception of
// the real Service Worker's requests. No host firewall or interface is changed.
const root = fileURLToPath(new URL('..', import.meta.url));
const script = fileURLToPath(import.meta.url);
if (!process.argv.includes('--child')) {
  const browserCache = dirname(dirname(dirname(chromium.executablePath())));
  const namespace = execFileSync('readlink', ['/proc/self/ns/net'], { encoding: 'utf8' }).trim();
  const childArgs = ['--net', process.execPath, script, '--child', String(process.getuid()), String(process.getgid()), namespace];
  const privileged = process.getuid() === 0;
  const command = privileged ? 'unshare' : 'sudo';
  const args = privileged ? childArgs : ['-n', '--preserve-env=HOME,PATH,PLAYWRIGHT_BROWSERS_PATH,HERMES_TEST_LOCAL_WEBKIT,HERMES_TEST_WEBKIT_PORT,DISPLAY,XAUTHORITY', 'unshare', ...childArgs];
  const child = spawnSync(command, args, { cwd: root, stdio: 'inherit', env: { ...process.env,
    PLAYWRIGHT_BROWSERS_PATH: browserCache } });
  if (child.error) throw child.error;
  process.exit(child.status ?? 1);
}

const index = process.argv.indexOf('--child');
const [uidText, gidText, parentNamespace] = process.argv.slice(index + 1);
assert.match(uidText ?? '', /^\d+$/); assert.match(gidText ?? '', /^\d+$/);
assert.match(parentNamespace ?? '', /^net:\[\d+\]$/);
assert.notEqual(execFileSync('readlink', ['/proc/self/ns/net'], { encoding: 'utf8' }).trim(), parentNamespace);
assert.equal(process.getuid(), 0, 'Creating the owned loopback requires namespace-local privilege');
execFileSync('ip', ['link', 'set', 'lo', 'up']);
assert.deepEqual(Object.keys(networkInterfaces()), ['lo']);
const routes = readFileSync('/proc/net/route', 'utf8').trim().split('\n').slice(1);
assert.equal(routes.length, 0, 'No non-loopback IPv4 route may exist');
process.setgid(Number(gidText)); process.setuid(Number(uidText));
const child = spawnSync(process.execPath, [fileURLToPath(new URL('./e2e-product-worker.mjs', import.meta.url))], {
  cwd: root, stdio: 'inherit', env: { ...process.env, HERMES_TEST_WORKER_NETWORK_ISOLATED: '1' },
});
if (child.error) throw child.error;
process.exit(child.status ?? 1);
