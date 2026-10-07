import assert from 'node:assert/strict';
import { basename, join } from 'node:path';

/** Paths passed here have already been resolved physically by the harness. */
export function requireDateFixtureRelease({ root, phase, selectedBuild, release, explicitRelease, manifestBuild }) {
  assert.ok(['before', 'after'].includes(phase));
  assert.match(selectedBuild, /^remote-v2-[a-f0-9]{16}$/);
  assert.match(manifestBuild, /^remote-v2-[a-f0-9]{16}$/);
  assert.equal(basename(release), manifestBuild);
  if (phase === 'after') {
    assert.equal(release, join(root, 'releases', selectedBuild), 'After must inspect the exact locally built release');
    assert.equal(manifestBuild, selectedBuild);
  } else {
    assert.ok(explicitRelease && release === join(root, 'releases', manifestBuild), 'Before requires an explicit release inside its isolated source root');
  }
}

/** Late diagnostics during teardown cannot retain an earlier PASS. */
export function finalDateStatus(result) {
  return finalBrowserStatus(result);
}

export function finalBrowserStatus(result) {
  return result.status === 'PASS' && result.pageErrors === 0 && result.warnings === 0
    && (result.cleanupErrors || []).length === 0 ? 'PASS' : 'FAIL';
}
