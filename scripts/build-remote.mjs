import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync, readdirSync, copyFileSync } from 'node:fs';
import { resolve, relative, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const hash = createHash('sha256');
function sources(directory) {
  for (const entry of readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) sources(path);
    else if (!/\.(map|tsbuildinfo)$/.test(path)) hash.update(relative(root, path)).update(readFileSync(path));
  }
}
sources(join(root, 'packages/core/src'));
sources(join(root, 'packages/web/src'));
sources(join(root, 'packages/web/remote-public'));
for (const path of ['package-lock.json', 'upstream.lock.json', 'patches/product/upstream.lock.json', 'LICENSE', 'NOTICE', 'THIRD_PARTY_NOTICES.md', 'packages/web/index.html', 'packages/web/vite.config.ts', 'scripts/build-remote.mjs']) hash.update(readFileSync(join(root, path)));
const buildInputsSha256 = hash.digest('hex');
const buildId = `remote-v2-${buildInputsSha256.slice(0, 16)}`;
const output = resolve(root, 'releases', buildId);
mkdirSync(output, { recursive: true });
execFileSync(join(root, 'node_modules/.bin/vite'), ['build', '--config', 'packages/web/vite.config.ts'], {
  cwd: root, stdio: 'inherit', env: { ...process.env, HERMES_REMOTE_BUILD_ID: buildId, HERMES_REMOTE_OUTPUT: output },
});
const backendLock = JSON.parse(readFileSync(join(root, 'patches/product/upstream.lock.json')));
writeFileSync(join(output, 'build.json'), `${JSON.stringify({ buildId, buildInputsSha256, targetHermesCommit: backendLock.upstreamBaseCommit,
  candidateBackendCommit: backendLock.candidateCommit, candidateBackendPatchSha256: backendLock.patchSha256 }, null, 2)}\n`);
copyFileSync(join(root, 'LICENSE'), join(output, 'LICENSE'));
copyFileSync(join(root, 'NOTICE'), join(output, 'NOTICE'));
copyFileSync(join(root, 'THIRD_PARTY_NOTICES.md'), join(output, 'THIRD_PARTY_NOTICES.md'));
copyFileSync(join(root, 'packages/core/src/vendor/hermes/LICENSE'), join(output, 'HERMES_SHARED_LICENSE'));
const lock = JSON.parse(readFileSync(join(root, 'package-lock.json'), 'utf8'));
const notices = [];
for (const [name, entry] of Object.entries(lock.packages)) {
  if (!name || entry.dev || entry.link) continue;
  const directory = join(root, name);
  for (const file of readdirSync(directory).filter(file => /^(LICENSE|LICENCE|COPYING|NOTICE)(\.|$)/i.test(file))) {
    notices.push(`\n${name} ${entry.version} ${file}\n${readFileSync(join(directory, file), 'utf8')}`);
  }
}
writeFileSync(join(output, 'DEPENDENCY_LICENSES.txt'), notices.join('\n'));
// One narrowly scoped worker. Only fixed public shell assets enter its allowlist;
// the worker and mutable build metadata are excluded to avoid self hashes/caches.
const shellAssets = [];
function staticShell(directory) {
  for (const entry of readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) staticShell(path);
    else {
      const name = relative(output, path);
      if (name === 'index.html' || name === 'manifest.json' || name.startsWith('assets/') || name.startsWith('icons/')) {
        shellAssets.push({ path: `/hermes-remote-web/${name}`, sha256: createHash('sha256').update(readFileSync(path)).digest('hex') });
      }
    }
  }
}
staticShell(output);
const worker = join(output, 'remote-worker.js');
const workerSource = readFileSync(worker, 'utf8');
if (!workerSource.includes("const CONFIG = { buildId: 'development', assets: [] };")) throw new Error('Worker build marker mismatch');
writeFileSync(worker, workerSource.replace("const CONFIG = { buildId: 'development', assets: [] };", `const CONFIG = ${JSON.stringify({ buildId, assets: shellAssets })};`));
const entries = [];
function manifest(directory) {
  for (const entry of readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) manifest(path);
    else if (entry.name !== 'SHA256SUMS') entries.push(`${createHash('sha256').update(readFileSync(path)).digest('hex')}  ${relative(output, path)}`);
  }
}
manifest(output);
writeFileSync(join(output, 'SHA256SUMS'), `${entries.join('\n')}\n`);
writeFileSync(join(root, 'releases/current-build.txt'), `${buildId}\n`);
console.log(`Build ${buildId}\nStatic release: ${output}`);
