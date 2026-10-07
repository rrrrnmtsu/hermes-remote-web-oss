import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const stages = ['text-pilot', 'image-turn', 'product'].map(name => {
  const directory = join(root, 'patches', name);
  const lock = JSON.parse(readFileSync(join(directory, 'upstream.lock.json')));
  const patch = join(directory, `hermes-${name}.patch`);
  assert.equal(sha(readFileSync(patch)), lock.patchSha256);
  assert.equal(sha(readFileSync(join(directory, 'HERMES_LICENSE'))), lock.licenseSha256);
  const declared = [...readFileSync(patch, 'utf8').matchAll(/^diff --git a\/(.+) b\/\1$/gm)].map(match => match[1]);
  assert.deepEqual(declared.sort(), lock.files.map(file => file.path).sort());
  for (const file of lock.files) {
    assert.match(file.path, /^(?:run_agent\.py|(?:agent\/|apps\/shared\/src\/|tests\/(?:agent|tui_gateway)\/|tui_gateway\/)[A-Za-z0-9_./-]+)$/);
    assert.ok(!file.path.includes('..'));
    assert.match(file.patchedSha256, /^[a-f0-9]{64}$/);
    if (file.originalSha256 !== null) assert.match(file.originalSha256, /^[a-f0-9]{64}$/);
  }
  return { lock, patch };
});
for (let i = 1; i < stages.length; i++) {
  assert.equal(stages[i].lock.baseCommit, stages[i - 1].lock.candidateCommit);
  assert.equal(stages[i].lock.parentPatchSha256, stages[i - 1].lock.patchSha256);
}
const product = stages.at(-1).lock;
assert.equal(sha(readFileSync(join(root, 'patches/product', product.dependencyLicenseEvidence.file))), product.dependencyLicenseEvidence.sha256);
for (const dependency of product.dependencies) {
  assert.match(dependency.file, /^[a-zA-Z0-9_.-]+\.whl$/);
  assert.equal(sha(readFileSync(join(root, 'patches/product/wheels', dependency.file))), dependency.sha256);
}
const argument = name => { const index = process.argv.indexOf(name); return index === -1 ? '' : process.argv[index + 1]; };
const sourceArgument = argument('--source');
function fileHashes(source, files, key) {
  for (const file of files) {
    const path = join(source, file.path);
    if (file[key] === null) assert.equal(existsSync(path), false, `Unexpected existing ${file.path}`);
    else assert.equal(sha(readFileSync(path)), file[key], file.path);
  }
}
if (sourceArgument) {
  const source = resolve(sourceArgument);
  if (process.argv.includes('--apply')) {
    // Applying is restricted to an independent build/CI checkout, never the live source.
    assert.ok(source.startsWith(join(root, 'output') + '/'), 'Use an isolated output source checkout');
    assert.equal(execFileSync('git', ['-C', source, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(), product.upstreamBaseCommit);
    for (const stage of stages) {
      fileHashes(source, stage.lock.files, 'originalSha256');
      execFileSync('git', ['-C', source, 'apply', '--check', stage.patch]);
      execFileSync('git', ['-C', source, 'apply', stage.patch]);
      fileHashes(source, stage.lock.files, 'patchedSha256');
    }
  }
  fileHashes(source, product.compositeFiles, 'patchedSha256');
}
console.log(JSON.stringify({ status: 'PASS', candidateBackend: product.candidateCommit, patchSha256: product.patchSha256,
  compositeFiles: product.compositeFiles.length, dependencies: product.dependencies.length, sourceVerified: Boolean(sourceArgument),
  productionMutation: 0, generation: 0 }));
