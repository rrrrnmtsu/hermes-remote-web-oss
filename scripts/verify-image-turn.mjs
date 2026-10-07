import { createHash } from 'node:crypto';
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const directory = join(root, 'patches/image-turn');
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const paths = new Set([
  'agent/message_sanitization.py', 'agent/turn_context.py', 'agent/turn_recovery.py',
  'apps/shared/src/gateway-contract.generated.ts', 'apps/shared/src/gateway-contract.openrpc.json',
  'tui_gateway/contracts/liveness.py', 'tui_gateway/contracts/prompt_voice.py', 'tui_gateway/contracts/sessions.py',
  'tui_gateway/methods_prompt.py', 'tui_gateway/methods_voice.py', 'tui_gateway/prompt_turn.py', 'tui_gateway/rpc_dispatch.py',
  'tui_gateway/session_auto_continue.py', 'tui_gateway/session_history.py', 'tui_gateway/prompt_image_turn.py',
  'tests/tui_gateway/image_turn_harness.py', 'tests/tui_gateway/test_image_turn_integration.py', 'tests/tui_gateway/test_image_turn_validation.py',
]);
export function validateImagePatch(lock, patch, license, parent) {
  if (lock.schema !== 1 || !/^[a-f0-9]{40}$/.test(lock.candidateCommit)
    || lock.baseCommit !== parent.candidateCommit || lock.upstreamBaseCommit !== parent.baseCommit
    || lock.parentPatchSha256 !== parent.patchSha256 || sha(patch) !== lock.patchSha256 || sha(license) !== lock.licenseSha256
    || !Array.isArray(lock.files) || lock.files.length !== paths.size || new Set(lock.files.map(file => file.path)).size !== paths.size) {
    throw new Error('Fixed image/parent provenance differs');
  }
  const declared = [...patch.toString().matchAll(/^diff --git a\/(.+) b\/\1$/gm)].map(match => match[1]);
  if (declared.length !== paths.size || new Set(declared).size !== paths.size || declared.some(path => !paths.has(path))) {
    throw new Error('Patch paths differ from the reviewed scope');
  }
  for (const file of lock.files) {
    if (!paths.has(file.path) || !/^[a-f0-9]{64}$/.test(file.patchedSha256)
      || file.originalSha256 !== null && !/^[a-f0-9]{64}$/.test(file.originalSha256)) throw new Error('Invalid fixed file');
  }
}
export function verifySource(source) {
  const lock = JSON.parse(readFileSync(join(directory, 'upstream.lock.json')));
  const parent = JSON.parse(readFileSync(join(root, 'patches/text-pilot/upstream.lock.json')));
  const patch = join(directory, 'hermes-image-turn.patch');
  validateImagePatch(lock, readFileSync(patch), readFileSync(join(directory, 'HERMES_LICENSE')), parent);
  const git = (...args) => spawnSync('git', ['-C', source, ...args], { encoding: 'utf8' });
  if (git('rev-parse', 'HEAD').stdout.trim() !== lock.baseCommit) throw new Error('Source is not the fixed text-pilot parent');
  for (const file of lock.files) {
    const path = join(source, file.path);
    if (file.originalSha256 === null ? existsSync(path) : !existsSync(path) || sha(readFileSync(path)) !== file.originalSha256) {
      throw new Error('Source file differs from the fixed parent');
    }
  }
  if (git('apply', '--check', '--', patch).status !== 0) throw new Error('Patch cannot apply cleanly');
  return { status: 'PASS', mode: 'READ_ONLY_APPLY_CHECK', baseCommit: lock.baseCommit, candidateCommit: lock.candidateCommit,
    files: lock.files.length, patchSha256: lock.patchSha256, applied: false, serviceRestarted: false };
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv[2] !== '--source' || process.argv.length !== 4) throw new Error('Use --source <fixed-text-pilot-parent>');
  process.stdout.write(JSON.stringify(verifySource(resolve(process.argv[3])), null, 2) + '\n');
}
