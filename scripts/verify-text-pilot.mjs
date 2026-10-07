import { createHash } from 'node:crypto';
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const directory = join(root, 'patches/text-pilot');
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

export function validatePatch(lock, patch, license) {
  if (lock.schema !== 1 || !/^[0-9a-f]{40}$/.test(lock.baseCommit)
      || sha256(patch) !== lock.patchSha256 || sha256(license) !== lock.licenseSha256
      || !Array.isArray(lock.files) || !lock.files.length) {
    throw new Error('Patch provenance or bytes do not match the fixed receipt');
  }
  for (const file of lock.files) {
    if (!/^(?:agent|tui_gateway|tests\/agent|tests\/tui_gateway)\/[A-Za-z0-9_]+\.py$/.test(file.path)
        && file.path !== 'run_agent.py') throw new Error('Patch contains an unapproved path');
    if (!/^[0-9a-f]{64}$/.test(file.patchedSha256)
        || (file.originalSha256 !== null && !/^[0-9a-f]{64}$/.test(file.originalSha256))) {
      throw new Error('Patch contains invalid file hashes');
    }
  }
}

export function verifySource(source) {
  const lock = JSON.parse(readFileSync(join(directory, 'upstream.lock.json'), 'utf8'));
  const patchPath = join(directory, 'hermes-text-pilot.patch');
  validatePatch(lock, readFileSync(patchPath), readFileSync(join(directory, 'HERMES_LICENSE')));
  const git = (...args) => spawnSync('git', ['-C', source, ...args], { encoding: 'utf8' });
  const head = git('rev-parse', 'HEAD');
  if (head.status !== 0 || head.stdout.trim() !== lock.baseCommit) throw new Error('Target source commit differs');
  for (const file of lock.files) {
    const path = join(source, file.path);
    if (file.originalSha256 === null) {
      if (existsSync(path)) throw new Error('Target already has a new patch file');
    } else if (!existsSync(path) || sha256(readFileSync(path)) !== file.originalSha256) {
      throw new Error('Target source bytes differ from the fixed base');
    }
  }
  if (git('apply', '--check', '--', patchPath).status !== 0) throw new Error('Patch cannot apply cleanly');
  return { status: 'PASS', mode: 'READ_ONLY_APPLY_CHECK', baseCommit: lock.baseCommit,
    candidateCommit: lock.candidateCommit, patchSha256: lock.patchSha256,
    checkedFiles: lock.files.length, applied: false, serviceRestarted: false };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  if (args.length !== 2 || args[0] !== '--source') throw new Error('Usage: node scripts/verify-text-pilot.mjs --source <fixed-Hermes-source>');
  process.stdout.write(`${JSON.stringify(verifySource(resolve(args[1])), null, 2)}\n`);
}
