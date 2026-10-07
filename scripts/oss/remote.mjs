import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { prepareStatic, activateStatic, readCandidate } from './static-site.mjs';
import { doctor, canonicalOrigin, observePublishedBaseline, verifyPublishedStatic } from './doctor.mjs';

try {
const command = process.argv[2], raw = process.argv.slice(3), args = new Map();
for (let n = 0; n < raw.length; n++) {
  const key = raw[n]; assert.match(key, /^--(?:origin|release|root|candidate|sha256|apply|lock-held)$/);
  assert.ok(!args.has(key), 'Duplicate argument');
  if (['--apply', '--lock-held'].includes(key)) args.set(key, true);
  else { assert.ok(raw[n + 1] && !raw[n + 1].startsWith('--')); args.set(key, raw[++n]); }
}
assert.ok(['doctor', 'prepare', 'deploy', 'rollback'].includes(command), 'Use doctor, prepare, deploy or rollback');
const allowed = command === 'doctor' ? ['--origin'] : command === 'prepare'
  ? ['--release', '--root', '--apply', '--lock-held'] : ['--candidate', '--sha256', '--origin', '--apply', '--lock-held'];
assert.ok([...args.keys()].every(key => allowed.includes(key)), 'Unexpected command argument');
const apply = args.get('--apply') === true;
if (apply && !args.get('--lock-held')) {
  assert.equal(process.platform, 'linux', 'Static apply currently requires Linux/flock');
  const root = command === 'prepare' ? args.get('--root') : readCandidate(args.get('--candidate'), args.get('--sha256')).root;
  assert.ok(typeof root === 'string' && root.startsWith('/'));
  const lock = join(root, 'deployment.lock');
  execFileSync('flock', ['-n', lock, process.execPath, fileURLToPath(import.meta.url), command, ...raw, '--lock-held'], { stdio: 'inherit' });
} else {
  if (apply) {
    const root = command === 'prepare' ? args.get('--root') : readCandidate(args.get('--candidate'), args.get('--sha256')).root;
    const lock = join(root, 'deployment.lock');
    const parent = readFileSync(`/proc/${process.ppid}/cmdline`, 'utf8').split('\0');
    assert.ok((parent[0] === 'flock' || parent[0].endsWith('/flock')) && parent.includes('-n') && parent.includes(lock), 'Owned flock required');
    const meta = statSync(lock, { bigint: true });
    const major = ((meta.dev >> 8n) & 0xfffn) | ((meta.dev >> 32n) & 0xfffff000n);
    const minor = (meta.dev & 0xffn) | ((meta.dev >> 12n) & 0xffffff00n);
    assert.ok(readFileSync('/proc/locks', 'utf8').split('\n').some(line => {
      const parts = line.trim().split(/\s+/), [a, b, inode] = parts[5]?.split(':') || [];
      return parts[1] === 'FLOCK' && parts[3] === 'WRITE' && Number(parts[4]) === process.ppid
        && a && b && inode === String(meta.ino) && BigInt(`0x${a}`) === major && BigInt(`0x${b}`) === minor;
    }), 'Unverified deployment lock');
  }
  let result;
  if (command === 'doctor') { assert.ok(!apply); result = await doctor(args.get('--origin')); }
  else if (command === 'prepare') result = prepareStatic({ release: resolve(args.get('--release')), root: resolve(args.get('--root')), apply });
  else {
    const options = { candidate: resolve(args.get('--candidate')), expectedHash: args.get('--sha256'), apply, rollback: command === 'rollback' };
    if (args.has('--origin')) {
      const origin = canonicalOrigin(args.get('--origin')), data = readCandidate(options.candidate, options.expectedHash);
      const currentRows = command === 'rollback' ? data.siteFiles : data.before.files;
      const observed = apply ? await observePublishedBaseline(origin, currentRows) : [];
      const aliases = new Map(observed.map(row => [row.file, row]));
      options.verify = async target => ({ https: 'PASS', staticFiles: (await verifyPublishedStatic(origin,
        target === data.site ? data.siteFiles : data.rollbackFiles, aliases)).length });
    }
    result = await activateStatic(options);
    result.httpsAcceptance = result.verification?.https === 'PASS' ? 'PASS' : 'NOT_RUN';
    result.authWssReadRpcAcceptance = 'REQUIRES_EXISTING_BROWSER_AUTH';
  }
  console.log(JSON.stringify(result, null, 2));
  if (['FAILED', 'ROLLBACK_UNCONFIRMED', 'REVIEW_REQUIRED', 'REFERENCE_CHANGED_NO_ROLLBACK'].includes(result.status)
    || (apply && command !== 'prepare' && !result.actionCompleted)) process.exitCode = 1;
}
} catch {
  // Invalid user arguments and assertions can include private input. Never print them.
  console.error(JSON.stringify({ status: 'REFUSED', errorCategory: 'ARGUMENT_LOCK_OR_STATIC_INTEGRITY', serviceRestarts: 0, backendWrites: 0 }));
  process.exitCode = 1;
}
