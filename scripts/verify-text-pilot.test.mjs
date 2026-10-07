import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { validatePatch } from './verify-text-pilot.mjs';

const hash = (value) => createHash('sha256').update(value).digest('hex');
const patch = Buffer.from('synthetic patch fixture');
const license = Buffer.from('synthetic license fixture');
const lock = { schema: 1, baseCommit: 'a'.repeat(40), patchSha256: hash(patch), licenseSha256: hash(license),
  files: [{ path: 'agent/text_pilot.py', originalSha256: null, patchedSha256: 'b'.repeat(64) }] };

test('fixed bytes pass and any altered patch or license fails', () => {
  assert.doesNotThrow(() => validatePatch(lock, patch, license));
  assert.throws(() => validatePatch(lock, Buffer.from('altered'), license));
  assert.throws(() => validatePatch(lock, patch, Buffer.from('altered')));
});

test('out-of-scope paths and invalid hashes fail before checking a target', () => {
  for (const path of ['../auth.json', 'agent/../auth.json', '/etc/systemd/system/hermes-serve.service']) {
    assert.throws(() => validatePatch({ ...lock, files: [{ ...lock.files[0], path }] }, patch, license));
  }
  assert.throws(() => validatePatch({ ...lock, files: [{ ...lock.files[0], patchedSha256: 'invalid' }] }, patch, license));
});
