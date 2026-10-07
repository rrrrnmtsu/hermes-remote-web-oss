import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { validateImagePatch } from './verify-image-turn.mjs';
const read = path => readFileSync(new URL(`../${path}`, import.meta.url));
const lock = JSON.parse(read('patches/image-turn/upstream.lock.json'));
const parent = JSON.parse(read('patches/text-pilot/upstream.lock.json'));
const patch = read('patches/image-turn/hermes-image-turn.patch'), license = read('patches/image-turn/HERMES_LICENSE');
test('the fixed image patch and its unchanged text-pilot parent verify', () => assert.doesNotThrow(() => validateImagePatch(lock, patch, license, parent)));
test('altered bytes, parent, file hashes and scope are rejected', () => {
  assert.throws(() => validateImagePatch(lock, Buffer.from('altered'), license, parent));
  assert.throws(() => validateImagePatch(lock, patch, Buffer.from('altered'), parent));
  assert.throws(() => validateImagePatch(lock, patch, license, { ...parent, candidateCommit: 'f'.repeat(40) }));
  for (const path of ['../auth.json', 'tui_gateway/../auth.json', '/etc/systemd/system/hermes-serve.service']) {
    assert.throws(() => validateImagePatch({ ...lock, files: [{ ...lock.files[0], path }, ...lock.files.slice(1)] }, patch, license, parent));
  }
  assert.throws(() => validateImagePatch({ ...lock, files: [{ ...lock.files[0], patchedSha256: 'bad' }, ...lock.files.slice(1)] }, patch, license, parent));
});
