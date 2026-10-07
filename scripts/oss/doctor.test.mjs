import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync, execFileSync } from 'node:child_process';
import { createServer } from 'node:https';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { doctor, canonicalOrigin, readPublic, verifyPublishedStatic, observePublishedBaseline } from './doctor.mjs';
import { sha256 } from './static-site.mjs';

const reply = (status, body = '{}', mime = 'application/json') => ({ status, body: Buffer.from(body), mime });
function responses(auth = 401) {
  return { '/hermes-remote-web/build.json': reply(200, JSON.stringify({ buildId: 'remote-v2-0123456789abcdef' })),
    '/hermes-remote-web/': reply(200, '<html>DEMO only</html>', 'text/html; charset=utf-8'),
    '/api/status': reply(200, '{"version":"0.21.5+DEMOsecret"}'), '/api/auth/me': reply(auth, '{"private":"DEMO-dont-log"}') };
}
test('doctor is public GET-only and distinguishes login protection from functional acceptance', async () => {
  const paths = [], table = responses();
  const report = await doctor('https://hermes.example', async (origin, path) => { paths.push(path); assert.equal(origin, 'https://hermes.example'); return table[path]; });
  assert.equal(report.status, 'PUBLIC_READS_PASS_BROWSER_AUTH_PENDING'); assert.equal(report.targetVersion, '0.21.5');
  assert.equal(report.wssAndReadRPC, 'REQUIRES_EXISTING_BROWSER_AUTH'); assert.equal(report.generation, 'NOT_RUN');
  assert.deepEqual(paths, Object.keys(table)); assert.ok(!JSON.stringify(report).includes('DEMO'));
  for (const auth of [200, 403, 500]) {
    const other = responses(auth); assert.equal((await doctor('https://hermes.example', async (_, path) => other[path])).status, 'REVIEW_REQUIRED');
  }
});
test('invalid origins, redirects, untrusted paths and raw response errors are never accepted or logged', async () => {
  for (const origin of ['http://hermes.example', 'https://u:DEMOsecret@hermes.example', 'https://hermes.example/path', 'https://hermes.example/?ticket=DEMO', 'not-a-url']) assert.throws(() => canonicalOrigin(origin));
  for (const path of ['/api/prompt', '/hermes-remote-web/../api/settings', '/hermes-remote-web/?ticket=DEMO', '//another.example/path']) assert.throws(() => readPublic('https://hermes.example', path));
  const malformed = responses(); malformed['/api/status'] = reply(200, 'DEMO-invalid-private-response');
  const result = await doctor('https://hermes.example', async (_, path) => malformed[path]);
  assert.equal(result.status, 'FAILED'); assert.ok(!JSON.stringify(result).includes('DEMO'));
  for (const category of ['HTTP_TIMEOUT', 'TLS_VALIDATION', 'NETWORK', 'HTTP_RESPONSE_BOUND', 'DEMO-raw-private-error']) {
    const report = await doctor('https://hermes.example', async () => { throw new Error(category); });
    assert.equal(report.status, 'FAILED'); assert.ok(!JSON.stringify(report).includes('DEMO'));
  }
  const cli = spawnSync(process.execPath, [new URL('./remote.mjs', import.meta.url).pathname, 'doctor', '--origin', 'https://u:DEMOsecret@hermes.example'], { encoding: 'utf8' });
  assert.notEqual(cli.status, 0); assert.ok(!cli.stdout.includes('DEMO') && !cli.stderr.includes('DEMO'));
});
test('static acceptance binds bytes and MIME; legacy audio/webm is allowed only for unchanged old hash', async () => {
  const bytes = Buffer.from('synthetic bytes'), row = { file: 'assets/old.webm', sha256: sha256(bytes) };
  const reader = async () => ({ status: 200, mime: 'audio/webm', body: bytes });
  await assert.rejects(verifyPublishedStatic('https://hermes.example', [row], new Map(), reader), /MIME/);
  const observed = await observePublishedBaseline('https://hermes.example', [row], reader);
  await verifyPublishedStatic('https://hermes.example', [row], new Map(observed.map(item => [item.file, item])), reader);
  await assert.rejects(verifyPublishedStatic('https://hermes.example', [{ ...row, sha256: sha256('changed') }], new Map(), reader), /bytes/);
  const js = { file: 'assets/new.js', sha256: row.sha256 };
  await assert.rejects(verifyPublishedStatic('https://hermes.example', [js], new Map(), reader), /MIME/);
  await assert.rejects(verifyPublishedStatic('https://hermes.example', [row], new Map(), async () => ({ status: 302, mime: 'video/webm', body: bytes })), /response/);
});

test('real Node HTTPS rejects an owned untrusted certificate without a TLS exception', async () => {
  const root = mkdtempSync(join(tmpdir(), 'hermes-oss-tls-'));
  const key = join(root, 'fixture.key'), cert = join(root, 'fixture.crt');
  execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1', '-keyout', key, '-out', cert, '-subj', '/CN=localhost', '-addext', 'subjectAltName=DNS:localhost,IP:127.0.0.1'], { stdio: 'ignore' });
  const server = createServer({ key: readFileSync(key), cert: readFileSync(cert) }, (_, response) => { response.end('{}'); });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const origin = `https://127.0.0.1:${server.address().port}`;
    await assert.rejects(readPublic(origin, '/api/status'), /TLS_VALIDATION/);
    const report = await doctor(origin);
    assert.equal(report.status, 'FAILED'); assert.equal(report.errorCategory, 'TLS_VALIDATION');
    assert.ok(!JSON.stringify(report).includes('127.0.0.1'));
  } finally { await new Promise(resolve => server.close(resolve)); }
});
