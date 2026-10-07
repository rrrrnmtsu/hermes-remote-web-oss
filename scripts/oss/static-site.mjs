import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { constants, copyFileSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, realpathSync, renameSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';

export const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const entrypoints = new Set(['index.html', 'build.json', 'manifest.json', 'remote-worker.js', 'SHA256SUMS',
  'LICENSE', 'NOTICE', 'THIRD_PARTY_NOTICES.md', 'HERMES_SHARED_LICENSE', 'DEPENDENCY_LICENSES.txt']);
const writeJSON = (file, value) => writeFileSync(file, JSON.stringify(value, null, 2) + '\n', { flag: 'wx', mode: 0o600 });

function realDirectory(path) {
  assert.ok(typeof path === 'string' && path.startsWith('/'), 'An explicit absolute directory is required');
  const canonical = realpathSync(path);
  assert.equal(canonical, resolve(path), 'Directory symlink aliases are not supported');
  assert.ok(statSync(canonical).isDirectory());
  return canonical;
}

export function staticInventory(path) {
  const root = realDirectory(path), rows = [];
  function visit(directory) {
    for (const entry of readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      assert.ok(!entry.isSymbolicLink(), 'Static files must not follow symlinks');
      const file = join(directory, entry.name), name = relative(root, file);
      assert.match(name, /^[A-Za-z0-9._/-]+$/); assert.ok(!name.split('/').includes('..'));
      if (entry.isDirectory()) visit(file);
      else {
        assert.ok(entry.isFile() && statSync(file).size <= 8 * 1024 * 1024, 'Static file limit');
        assert.ok(!/\.(?:py|pem|key|p12|pfx|sqlite|db)$/i.test(name) && !name.split('/').includes('.env'), 'Not a static public asset');
        rows.push({ file: name, sha256: sha256(readFileSync(file)), bytes: statSync(file).size });
      }
    }
  }
  visit(root);
  assert.ok(rows.length >= 4 && rows.length <= 1024 && rows.reduce((n, r) => n + r.bytes, 0) <= 256 * 1024 * 1024, 'Inventory limits');
  return rows;
}

export function verifySums(directory, rows = staticInventory(directory)) {
  const lines = readFileSync(join(directory, 'SHA256SUMS'), 'utf8').trim().split('\n');
  const recorded = new Map();
  for (const line of lines) {
    const [digest, file] = line.split('  ');
    assert.match(digest, /^[a-f0-9]{64}$/); assert.match(file, /^[A-Za-z0-9._/-]+$/);
    assert.ok(file !== 'SHA256SUMS' && !file.startsWith('/') && !file.split('/').includes('..') && !recorded.has(file));
    recorded.set(file, digest);
  }
  assert.equal(recorded.size, rows.length - 1, 'Checksum inventory is incomplete');
  for (const row of rows.filter(r => r.file !== 'SHA256SUMS')) assert.equal(recorded.get(row.file), row.sha256, 'Checksum mismatch');
}

export function validateRelease(path) {
  const directory = realDirectory(path), files = staticInventory(directory);
  verifySums(directory, files);
  const build = JSON.parse(readFileSync(join(directory, 'build.json')));
  assert.match(build.buildId || '', /^remote-v2-[a-f0-9]{16}$/);
  assert.match(build.buildInputsSha256 || '', /^[a-f0-9]{64}$/);
  assert.equal(build.buildInputsSha256.slice(0, 16), build.buildId.slice('remote-v2-'.length));
  const manifest = JSON.parse(readFileSync(join(directory, 'manifest.json')));
  for (const field of ['id', 'scope', 'start_url']) assert.equal(manifest[field], '/hermes-remote-web/');
  const html = readFileSync(join(directory, 'index.html'), 'utf8');
  const module = html.match(/<script\b[^>]*\bsrc="([^"]+)"[^>]*>/)?.[1];
  assert.match(module || '', /^\/hermes-remote-web\/assets\/[A-Za-z0-9._-]+\.js$/);
  assert.ok(files.some(row => row.file === module.slice('/hermes-remote-web/'.length)));
  return { directory, build: build.buildId, buildInputsSha256: build.buildInputsSha256, files };
}

function observeCurrent(root) {
  const current = join(root, 'current');
  if (!existsSync(current)) {
    // A dangling symlink is not an empty first install.
    try { assert.ok(!lstatSync(current).isSymbolicLink(), 'Unknown dangling current'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    return { target: null, files: [], build: null };
  }
  assert.ok(lstatSync(current).isSymbolicLink(), 'current must be an existing managed symlink');
  const target = realpathSync(current);
  assert.ok(target.startsWith(root + '/releases/'), 'current must belong to this explicit static root');
  const release = validateRelease(target);
  return { target, files: release.files, build: release.build };
}

function copy(source, target, rows) {
  mkdirSync(target, { recursive: true, mode: 0o755 });
  for (const row of rows) {
    const file = join(target, row.file);
    if (existsSync(file)) assert.equal(sha256(readFileSync(file)), row.sha256, 'Asset collision');
    else {
      mkdirSync(dirname(file), { recursive: true, mode: 0o755 });
      copyFileSync(join(source, row.file), file, constants.COPYFILE_EXCL);
      assert.equal(sha256(readFileSync(file)), row.sha256, 'Source changed during copy');
    }
  }
}

function reseal(path) {
  const files = staticInventory(path).filter(row => row.file !== 'SHA256SUMS');
  writeFileSync(join(path, 'SHA256SUMS'), files.map(row => `${row.sha256}  ${row.file}`).join('\n') + '\n', { mode: 0o644 });
  return staticInventory(path);
}

export function prepareStatic({ release, root: suppliedRoot, apply = false }) {
  const root = realDirectory(suppliedRoot), newer = validateRelease(release), before = observeCurrent(root);
  for (const name of ['releases', 'deployments']) {
    const directory = join(root, name);
    // Refuse existing symlink parents before any candidate/backup write.
    if (existsSync(directory)) realDirectory(directory);
    else {
      try { assert.ok(!lstatSync(directory).isSymbolicLink(), 'Dangling managed directory'); }
      catch (error) { if (error.code !== 'ENOENT') throw error; }
    }
  }
  for (const old of before.files) {
    const row = newer.files.find(item => item.file === old.file);
    if (row && !entrypoints.has(row.file)) assert.equal(row.sha256, old.sha256, 'Versioned asset or retained page collision');
  }
  const summary = { schema: 'hermes_remote_web_static_plan_v1', status: apply ? 'PREPARING' : 'DRY_RUN',
    build: newer.build, previousBuild: before.build, previousFiles: before.files.length, payloadFiles: newer.files.length,
    firstInstall: before.target === null, restarts: 0, writesToBackend: 0, reloads: 0 };
  if (!apply) return summary;
  const id = `${newer.build}-${new Date().toISOString().replace(/[:.]/g, '-')}-${randomUUID().slice(0, 8)}`;
  const parent = join(root, 'releases', id), records = join(root, 'deployments', id);
  mkdirSync(parent, { recursive: true, mode: 0o755 }); mkdirSync(records, { recursive: true, mode: 0o700 });
  const site = join(parent, 'site'), rollback = before.target ? join(parent, 'rollback-site') : null;
  const backup = before.target ? join(parent, 'backup-site') : null;
  copy(newer.directory, site, newer.files);
  if (before.target) {
    copy(before.target, backup, before.files);
    assert.deepEqual(staticInventory(backup), before.files, 'Actual old backup mismatch');
    copy(before.target, site, before.files.filter(old => !newer.files.some(row => row.file === old.file)));
    copy(before.target, rollback, before.files);
    copy(newer.directory, rollback, newer.files.filter(row => !before.files.some(old => old.file === row.file)));
  }
  const siteFiles = reseal(site), rollbackFiles = rollback ? reseal(rollback) : [];
  assert.deepEqual(observeCurrent(root), before, 'Current drift while preparing');
  const candidate = { ...summary, schema: 'hermes_remote_web_static_candidate_v1', status: 'PREPARED_NOT_DEPLOYED',
    root, records, site, rollback, backup, before, payload: newer, siteFiles, rollbackFiles };
  const file = join(records, 'candidate.json'); writeJSON(file, candidate);
  return { ...summary, status: candidate.status, candidate: file, candidateSha256: sha256(readFileSync(file)) };
}

export function readCandidate(path, expectedHash) {
  assert.match(expectedHash || '', /^[a-f0-9]{64}$/, 'Exact candidate checksum is required');
  assert.equal(realpathSync(path), resolve(path));
  assert.ok(statSync(path).size <= 2 * 1024 * 1024);
  const raw = readFileSync(path); assert.equal(sha256(raw), expectedHash, 'Candidate changed');
  const candidate = JSON.parse(raw);
  assert.equal(candidate.schema, 'hermes_remote_web_static_candidate_v1');
  const root = realDirectory(candidate.root);
  assert.ok(path.startsWith(root + '/deployments/'));
  assert.equal(candidate.records, dirname(path), 'Receipt directory must own this candidate');
  realDirectory(candidate.records);
  for (const target of [candidate.site, candidate.rollback, candidate.backup].filter(Boolean)) {
    assert.ok(target.startsWith(root + '/releases/')); realDirectory(target);
  }
  assert.deepEqual(staticInventory(candidate.site), candidate.siteFiles);
  verifySums(candidate.site, candidate.siteFiles);
  if (candidate.rollback) { assert.deepEqual(staticInventory(candidate.rollback), candidate.rollbackFiles); verifySums(candidate.rollback, candidate.rollbackFiles); }
  if (candidate.backup) assert.deepEqual(staticInventory(candidate.backup), candidate.before.files);
  return candidate;
}

function atomicSwitch(root, target) {
  const temporary = join(root, `.current-pending-${randomUUID()}`);
  assert.ok(!existsSync(temporary)); symlinkSync(target, temporary); renameSync(temporary, join(root, 'current'));
  assert.equal(realpathSync(join(root, 'current')), target);
}

/** Production callers hold flock around this operation; tests use owned disposable roots. */
export async function activateStatic({ candidate: path, expectedHash, apply = false, rollback = false, verify = async () => undefined }) {
  const data = readCandidate(path, expectedHash), current = observeCurrent(data.root);
  if (rollback) {
    assert.ok(data.rollback, 'No previous release for this first install');
    assert.equal(current.target, data.site, 'Rollback cannot overwrite another release');
    assert.deepEqual(current.files, data.siteFiles);
  } else assert.deepEqual(current, data.before, 'Current changed; re-prepare without overwriting it');
  const target = rollback ? data.rollback : data.site;
  if (!apply) return { status: 'DRY_RUN', build: rollback ? data.previousBuild : data.build, rollbackAvailable: Boolean(data.rollback), restarts: 0 };
  const result = { schema: 'hermes_remote_web_static_activation_v1', candidateSha256: expectedHash,
    timestamp: new Date().toISOString(), build: rollback ? data.previousBuild : data.build,
    action: rollback ? 'rollback' : 'deploy', status: 'PRE_SWITCH', actionCompleted: false,
    restarts: 0, writesToBackend: 0, reloads: 0 };
  // An initial-install failure has no safe prior target to invent.
  try {
    atomicSwitch(data.root, target); result.verification = await verify(target);
    assert.equal(realpathSync(join(data.root, 'current')), target);
    assert.deepEqual(staticInventory(target), rollback ? data.rollbackFiles : data.siteFiles);
    result.status = rollback ? 'ROLLED_BACK_STATIC_VERIFIED' : 'DEPLOYED_STATIC_VERIFIED';
    result.actionCompleted = true;
  } catch {
    result.status = 'FAILED';
    let observedTarget;
    try { observedTarget = realpathSync(join(data.root, 'current')); } catch { /* Unknown references are not overwritten. */ }
    if (!rollback && data.rollback && observedTarget === data.site) {
      try {
        atomicSwitch(data.root, data.rollback); result.verification = await verify(data.rollback);
        assert.equal(realpathSync(join(data.root, 'current')), data.rollback);
        assert.deepEqual(staticInventory(data.rollback), data.rollbackFiles);
        result.status = 'ROLLED_BACK_STATIC_VERIFIED';
      }
      catch { result.status = 'ROLLBACK_UNCONFIRMED'; }
    } else if (observedTarget !== target) result.status = 'REFERENCE_CHANGED_NO_ROLLBACK';
  }
  writeJSON(join(data.records, `activation-${Date.now()}-${randomUUID().slice(0, 8)}.json`), result);
  return result;
}
