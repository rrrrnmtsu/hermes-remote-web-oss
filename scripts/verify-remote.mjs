import { readFileSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve, join } from 'node:path';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
const root = resolve(new URL('..', import.meta.url).pathname);
const build = readFileSync(join(root, 'releases/current-build.txt'), 'utf8').trim();
const directory = join(root, 'releases', build);
const manifest = JSON.parse(readFileSync(join(directory, 'manifest.json'), 'utf8'));
for (const field of ['id', 'scope', 'start_url']) assert.equal(manifest[field], '/hermes-remote-web/');
const html = readFileSync(join(directory, 'index.html'), 'utf8');
assert.ok(html.includes('lang="ja"'));
assert.ok(!html.includes('user-scalable=no') && !html.includes('fonts.googleapis'));
const files = readdirSync(directory);
assert.ok(!files.some(file => /\.py$|plugin\.yaml|service-worker|sw\.js/.test(file)));
assert.ok(readFileSync(join(directory, 'NOTICE'), 'utf8').includes('NOT a clean-room'));
assert.ok(readFileSync(join(root, 'plugin.yaml'), 'utf8').includes('provides_hooks: []'));
execFileSync('python3', ['-c', `import ast
tree = ast.parse(open('__init__.py').read())
function = next(node for node in tree.body if isinstance(node, ast.FunctionDef) and node.name == 'register')
namespace = {'Any': object}
exec(compile(ast.Module(body=[function], type_ignores=[]), '__init__.py', 'exec'), namespace)
class FixtureContext:
    def register_hook(self, *args): raise AssertionError('Notification hook registered')
namespace['register'](FixtureContext())
`], { cwd: root });
const js = readdirSync(join(directory, 'assets')).filter(file => file.endsWith('.js')).map(file => readFileSync(join(directory, 'assets', file), 'utf8')).join('\n');
assert.ok(!js.includes('__DEMO_image_queue') && !js.includes('DEMO-image-fixture'), 'Image fixture prerequisites leaked into production');
assert.ok(!js.includes('ImageFixtureAccess'), 'Synthetic image ownership port leaked into production');
const productLock = JSON.parse(readFileSync(join(root, 'patches/product/upstream.lock.json'), 'utf8'));
const generated = productLock.files.find(file => file.path === 'apps/shared/src/gateway-contract.generated.ts');
assert.equal(createHash('sha256').update(readFileSync(join(root, 'packages/core/src/vendor/hermes/gateway-contract.generated.ts'))).digest('hex'), generated.patchedSha256);
for (const forbidden of ['hermes-pwa.active-session', 'push/subscribe', 'push/unsubscribe', 'kanban.create', 'cron.create', 'plugins.install', 'localStorage.clear']) assert.ok(!js.includes(forbidden), `Forbidden active bundle feature: ${forbidden}`);
// Opt-in worker is a single own-scope static allowlist. Never cache backend data.
const worker = readFileSync(join(directory, 'remote-worker.js'), 'utf8');
const config = JSON.parse(worker.match(/const CONFIG = (\{[^\n]+\});/)[1]);
assert.equal(config.buildId, build);
assert.ok(config.assets.length >= 4);
for (const asset of config.assets) {
  assert.match(asset.path, /^\/hermes-remote-web\/(?:index\.html|manifest\.json|assets\/[A-Za-z0-9._-]+|icons\/[A-Za-z0-9._-]+)$/);
  assert.equal(createHash('sha256').update(readFileSync(join(directory, asset.path.slice('/hermes-remote-web/'.length)))).digest('hex'), asset.sha256);
}
assert.ok(!worker.includes('clients.claim(') && !worker.includes('localStorage.clear('));
assert.ok(!worker.match(/addEventListener\(['"]install['"][\s\S]{0,500}skipWaiting/));
assert.ok(worker.includes('hermes-remote-web.static.v1.') && worker.includes('ACTIVATE_REQUEST'));
assert.ok(!js.includes('hermes-remote-web.connection-token'));
for (const line of readFileSync(join(directory, 'SHA256SUMS'), 'utf8').trim().split('\n')) {
  const [hash, file] = line.split('  ');
  assert.equal(createHash('sha256').update(readFileSync(join(directory, file))).digest('hex'), hash, file);
}
console.log(`PASS: ${build}; manifest scope, static-only packaging, privacy/admin exclusion and all file hashes verified.`);
