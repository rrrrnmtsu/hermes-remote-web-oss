import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, realpathSync, symlinkSync, renameSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { sha256, staticInventory, prepareStatic, readCandidate, activateStatic } from './static-site.mjs';

function release(root, name, extra = {}) {
  const directory = join(root, name); mkdirSync(join(directory, 'assets'), { recursive: true });
  const digest = sha256(name), buildId = 'remote-v2-' + digest.slice(0, 16);
  const files = { 'index.html': `<script type="module" src="/hermes-remote-web/assets/${name}.js"></script>`,
    'build.json': JSON.stringify({ buildId, buildInputsSha256: digest }),
    'manifest.json': JSON.stringify({ id: '/hermes-remote-web/', scope: '/hermes-remote-web/', start_url: '/hermes-remote-web/' }),
    [`assets/${name}.js`]: `/* synthetic ${name} */`, ...extra };
  for (const [name, value] of Object.entries(files)) writeFileSync(join(directory, name), value);
  writeFileSync(join(directory, 'SHA256SUMS'), Object.keys(files).sort((a, b) => a.localeCompare(b)).map(name => `${sha256(readFileSync(join(directory, name)))}  ${name}`).join('\n') + '\n');
  return directory;
}
function setup() {
  const root = mkdtempSync(join(tmpdir(), 'hermes-oss-static-'));
  mkdirSync(join(root, 'releases'));
  const old = release(join(root, 'releases'), 'old', { 'comparison.html': 'synthetic retained page', 'THIRD_PARTY_NOTICES.md': 'old notices' });
  symlinkSync(old, join(root, 'current'));
  const next = release(root, 'next', { 'THIRD_PARTY_NOTICES.md': 'new notices' });
  return { root, old, next };
}
function switchTo(root, target) {
  const pending = join(root, 'replacement'); symlinkSync(target, pending); renameSync(pending, join(root, 'current'));
}
function options(plan) { return { candidate: plan.candidate, expectedHash: plan.candidateSha256 }; }

test('dry-run creates no candidate; actual backup and both hashed clients survive deploy and rollback', async () => {
  const { root, old, next } = setup(), before = staticInventory(old);
  assert.equal(prepareStatic({ root, release: next }).status, 'DRY_RUN');
  assert.equal(realpathSync(join(root, 'current')), old);
  const plan = prepareStatic({ root, release: next, apply: true }), candidate = readCandidate(plan.candidate, plan.candidateSha256);
  assert.deepEqual(staticInventory(candidate.backup), before);
  assert.equal(readFileSync(join(candidate.site, 'THIRD_PARTY_NOTICES.md'), 'utf8'), 'new notices');
  assert.equal(readFileSync(join(candidate.rollback, 'THIRD_PARTY_NOTICES.md'), 'utf8'), 'old notices');
  for (const site of [candidate.site, candidate.rollback]) {
    assert.match(readFileSync(join(site, 'assets/old.js'), 'utf8'), /old/);
    assert.match(readFileSync(join(site, 'assets/next.js'), 'utf8'), /next/);
    assert.equal(readFileSync(join(site, 'comparison.html'), 'utf8'), 'synthetic retained page');
  }
  assert.equal((await activateStatic({ ...options(plan) })).status, 'DRY_RUN');
  assert.equal(realpathSync(join(root, 'current')), old);
  const deployed = await activateStatic({ ...options(plan), apply: true });
  assert.equal(deployed.status, 'DEPLOYED_STATIC_VERIFIED'); assert.equal(deployed.actionCompleted, true);
  const reverted = await activateStatic({ ...options(plan), apply: true, rollback: true });
  assert.equal(reverted.status, 'ROLLED_BACK_STATIC_VERIFIED'); assert.equal(reverted.actionCompleted, true);
  assert.equal(realpathSync(join(root, 'current')), candidate.rollback);
  assert.deepEqual(staticInventory(old), before);
});
test('asset collision, stale current, altered candidate or files are refused before cutover', async () => {
  const { root, old, next } = setup();
  const collision = release(root, 'collision', { 'assets/old.js': 'changed bytes' });
  assert.throws(() => prepareStatic({ root, release: collision, apply: true }), /collision/);
  const plan = prepareStatic({ root, release: next, apply: true });
  assert.throws(() => readCandidate(plan.candidate, '0'.repeat(64)), /changed/);
  const other = release(join(root, 'releases'), 'another'); switchTo(root, other);
  await assert.rejects(activateStatic({ ...options(plan), apply: true }), /Current changed/);
  assert.equal(realpathSync(join(root, 'current')), other);
  switchTo(root, old);
  const data = readCandidate(plan.candidate, plan.candidateSha256);
  writeFileSync(join(data.site, 'assets/next.js'), 'tampered');
  await assert.rejects(activateStatic({ ...options(plan), apply: true }));
  assert.equal(realpathSync(join(root, 'current')), old);
});
test('HTTPS rejection restores the bound actual old entrypoint but reports failed deployment', async () => {
  const { root, next } = setup(), plan = prepareStatic({ root, release: next, apply: true });
  const data = readCandidate(plan.candidate, plan.candidateSha256), checked = [];
  const result = await activateStatic({ ...options(plan), apply: true, verify: async site => {
    checked.push(site); if (site === data.site) throw new Error('synthetic TLS failure');
    return { https: 'PASS', staticFiles: data.rollbackFiles.length };
  } });
  assert.equal(result.status, 'ROLLED_BACK_STATIC_VERIFIED'); assert.equal(result.actionCompleted, false);
  assert.deepEqual(checked, [data.site, data.rollback]); assert.equal(realpathSync(join(root, 'current')), data.rollback);
});
test('a concurrently changed reference is never overwritten by automatic recovery', async () => {
  const { root, next } = setup(), plan = prepareStatic({ root, release: next, apply: true });
  const other = release(join(root, 'releases'), 'external');
  const result = await activateStatic({ ...options(plan), apply: true, verify: async () => { switchTo(root, other); throw new Error('drift'); } });
  assert.equal(result.status, 'REFERENCE_CHANGED_NO_ROLLBACK'); assert.equal(realpathSync(join(root, 'current')), other);
});
test('first installation invents no prior release; dangling current and escaped references are refused', async () => {
  const root = mkdtempSync(join(tmpdir(), 'hermes-oss-first-')), next = release(root, 'first');
  const plan = prepareStatic({ root, release: next, apply: true });
  const data = readCandidate(plan.candidate, plan.candidateSha256); assert.equal(data.rollback, null);
  const result = await activateStatic({ ...options(plan), apply: true, verify: async () => { throw new Error('synthetic failure'); } });
  assert.equal(result.status, 'FAILED'); assert.equal(result.actionCompleted, false);
  const danglingRoot = mkdtempSync(join(tmpdir(), 'hermes-oss-dangling-')); symlinkSync(join(danglingRoot, 'missing'), join(danglingRoot, 'current'));
  assert.throws(() => prepareStatic({ root: danglingRoot, release: next }), /dangling/);
  const escapedRoot = mkdtempSync(join(tmpdir(), 'hermes-oss-escaped-')); symlinkSync(next, join(escapedRoot, 'current'));
  assert.throws(() => prepareStatic({ root: escapedRoot, release: next }), /belong/);
});
test('public CLI applies only under an owned Linux flock and remains dry-run by default', () => {
  const { root, next } = setup(), cli = new URL('./remote.mjs', import.meta.url);
  const run = args => spawnSync(process.execPath, [cli.pathname, ...args], { encoding: 'utf8' });
  const dry = run(['prepare', '--release', next, '--root', root]); assert.equal(dry.status, 0); assert.equal(JSON.parse(dry.stdout).status, 'DRY_RUN');
  const forged = run(['prepare', '--release', next, '--root', root, '--apply', '--lock-held']); assert.notEqual(forged.status, 0);
  const prepared = run(['prepare', '--release', next, '--root', root, '--apply']); assert.equal(prepared.status, 0, prepared.stdout);
  const plan = JSON.parse(prepared.stdout);
  const deployed = run(['deploy', '--candidate', plan.candidate, '--sha256', plan.candidateSha256, '--apply']);
  assert.equal(deployed.status, 0, deployed.stdout); assert.equal(JSON.parse(deployed.stdout).httpsAcceptance, 'NOT_RUN');
  const rolled = run(['rollback', '--candidate', plan.candidate, '--sha256', plan.candidateSha256, '--apply']);
  assert.equal(rolled.status, 0, rolled.stdout); assert.equal(JSON.parse(rolled.stdout).status, 'ROLLED_BACK_STATIC_VERIFIED');
});

test('symlinked managed parent directories cannot route preparation writes outside the explicit root', () => {
  const root = mkdtempSync(join(tmpdir(), 'hermes-oss-parent-'));
  const outside = mkdtempSync(join(tmpdir(), 'hermes-oss-outside-'));
  const next = release(root, 'next');
  symlinkSync(outside, join(root, 'releases'));
  assert.throws(() => prepareStatic({ root, release: next, apply: true }), /symlink/);
});
