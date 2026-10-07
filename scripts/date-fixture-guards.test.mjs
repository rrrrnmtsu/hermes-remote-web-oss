import test from 'node:test';
import assert from 'node:assert/strict';
import { requireDateFixtureRelease, finalDateStatus, finalBrowserStatus } from './date-fixture-guards.mjs';

const build = 'remote-v2-0123456789abcdef';
const args = root => ({ root, phase: 'after', selectedBuild: build, manifestBuild: build,
  release: `${root}/releases/${build}`, explicitRelease: false });

test('after is portable to Actions and still bound to the exact built release', () => {
  requireDateFixtureRelease(args('/home/runner/work/hermes-remote-web/hermes-remote-web'));
  requireDateFixtureRelease(args('/tmp/DEMO-owned'));
  assert.throws(() => requireDateFixtureRelease({ ...args('/home/runner/work/DEMO'), release: `/opt/hermes-remote-web/releases/${build}` }));
  assert.throws(() => requireDateFixtureRelease({ ...args('/home/runner/work/DEMO'), manifestBuild: 'remote-v2-fedcba9876543210' }));
});

test('before requires an explicit isolated physical source release', () => {
  const before = { ...args('/tmp/DEMO-owned'), phase: 'before', explicitRelease: true };
  requireDateFixtureRelease(before);
  assert.throws(() => requireDateFixtureRelease({ ...before, explicitRelease: false }));
  assert.throws(() => requireDateFixtureRelease({ ...before, release: `/opt/hermes-remote-web/releases/${build}` }));
  assert.throws(() => requireDateFixtureRelease({ ...before, selectedBuild: '../DEMO' }));
});

test('late warnings, page errors and teardown failures invalidate PASS', () => {
  const good = { status: 'PASS', pageErrors: 0, warnings: 0, cleanupErrors: [] };
  assert.equal(finalDateStatus(good), 'PASS');
  assert.equal(finalBrowserStatus(good), 'PASS');
  for (const bad of [{ warnings: 1 }, { pageErrors: 1 }, { cleanupErrors: ['context'] }, { status: 'FAIL' }]) {
    assert.equal(finalDateStatus({ ...good, ...bad }), 'FAIL');
    assert.equal(finalBrowserStatus({ ...good, ...bad }), 'FAIL');
  }
});
