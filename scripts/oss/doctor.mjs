import assert from 'node:assert/strict';
import { request } from 'node:https';
import { extname } from 'node:path';
import { sha256 } from './static-site.mjs';

export function canonicalOrigin(input) {
  let url;
  try { url = new URL(input); } catch { throw new Error('INVALID_HTTPS_ORIGIN'); }
  assert.equal(url.protocol, 'https:', 'HTTPS required');
  assert.ok(!url.username && !url.password && !url.search && !url.hash && url.pathname === '/', 'Bare credential-free HTTPS origin required');
  return url.origin;
}

export function readPublic(origin, path, { timeout = 10000, byteLimit = 4 * 1024 * 1024 } = {}) {
  canonicalOrigin(origin);
  assert.ok(path === '/api/status' || path === '/api/auth/me' || path.startsWith('/hermes-remote-web/'));
  assert.ok(!path.split('/').includes('..') && !path.includes('\\') && !path.includes('?') && !path.includes('#'));
  const url = new URL(path, origin); assert.equal(url.origin, origin);
  return new Promise((resolve, reject) => {
    let total = 0; const chunks = [];
    const req = request(url, { method: 'GET', rejectUnauthorized: true, headers: { Accept: 'application/json, text/html;q=0.5' } }, response => {
      response.on('data', bytes => { total += bytes.length; if (total > byteLimit) req.destroy(new Error('HTTP_RESPONSE_BOUND')); else chunks.push(bytes); });
      response.on('end', () => resolve({ status: response.statusCode, mime: String(response.headers['content-type'] || ''), body: Buffer.concat(chunks) }));
    });
    req.setTimeout(timeout, () => req.destroy(new Error('HTTP_TIMEOUT')));
    req.on('error', error => {
      const tls = /^(?:ERR_TLS_|ERR_SSL_|CERT_|UNABLE_TO_VERIFY_|DEPTH_ZERO_|SELF_SIGNED_)/.test(String(error.code || ''));
      reject(new Error(error.message === 'HTTP_TIMEOUT' ? 'HTTP_TIMEOUT' : error.message === 'HTTP_RESPONSE_BOUND' ? 'HTTP_RESPONSE_BOUND' : tls ? 'TLS_VALIDATION' : 'NETWORK'));
    });
    req.end();
  });
}

export async function doctor(input, reader = readPublic) {
  const origin = canonicalOrigin(input);
  const report = { schema: 'hermes_remote_web_install_doctor_v1', status: 'RUNNING', tls: 'NOT_RUN',
    staticBuild: 'unknown', staticIndex: 'NOT_RUN', authentication: 'NOT_RUN', targetVersion: 'unknown',
    wssAndReadRPC: 'REQUIRES_EXISTING_BROWSER_AUTH', generation: 'NOT_RUN', backendWrites: 0,
    note: 'Public GET-only checks; complete auth/fresh-ticket/WSS/read-RPC in the Web client.' };
  try {
    const [build, index, status, auth] = await Promise.all(['/hermes-remote-web/build.json', '/hermes-remote-web/', '/api/status', '/api/auth/me'].map(path => reader(origin, path)));
    report.tls = 'PASS';
    if (build.status === 200) {
      const value = JSON.parse(build.body).buildId;
      if (/^remote-v2-[a-f0-9]{16}$/.test(value)) report.staticBuild = value;
    }
    report.staticIndex = index.status === 200 && /^text\/html\b/i.test(index.mime) ? 'PASS' : 'FAIL';
    if (status.status === 200) {
      const value = JSON.parse(status.body).version;
      if (typeof value === 'string') report.targetVersion = value.match(/^v?(\d{1,4}(?:\.\d{1,4}){1,3})(?:[-+][A-Za-z0-9.]{1,32})?$/)?.[1] || 'unknown';
    }
    report.authentication = auth.status === 401 ? 'LOGIN_REQUIRED_PROTECTED' : auth.status === 403 ? 'FORBIDDEN' : auth.status === 200 ? 'PUBLIC_AUTH_RESPONSE_REVIEW_REQUIRED' : 'UNEXPECTED_RESPONSE';
    report.status = report.staticBuild !== 'unknown' && report.staticIndex === 'PASS' && report.authentication === 'LOGIN_REQUIRED_PROTECTED'
      ? 'PUBLIC_READS_PASS_BROWSER_AUTH_PENDING' : 'REVIEW_REQUIRED';
  } catch (error) {
    report.status = 'FAILED';
    report.errorCategory = ['HTTP_TIMEOUT', 'HTTP_RESPONSE_BOUND', 'TLS_VALIDATION', 'NETWORK'].includes(error.message) ? error.message : 'PUBLIC_RESPONSE_OR_CONTRACT';
  }
  return report;
}

export async function verifyPublishedStatic(origin, rows, legacyMimes = new Map(), reader = readPublic) {
  canonicalOrigin(origin);
  const observed = [];
  for (const row of rows) {
    const path = '/hermes-remote-web/' + (row.file === 'index.html' ? '' : row.file);
    const result = await reader(origin, path, { byteLimit: 8 * 1024 * 1024 });
    assert.equal(result.status, 200, 'Static HTTPS response rejected');
    assert.equal(sha256(result.body), row.sha256, 'Static HTTPS bytes mismatch');
    const mime = result.mime.split(';')[0].trim().toLowerCase();
    const expected = { '.html': ['text/html'], '.js': ['text/javascript', 'application/javascript'], '.css': ['text/css'],
      '.json': ['application/json'], '.png': ['image/png'], '.jpg': ['image/jpeg'], '.jpeg': ['image/jpeg'],
      '.webm': ['video/webm'], '.svg': ['image/svg+xml'] }[extname(row.file)];
    if (expected) {
      const old = legacyMimes.get(row.file);
      // Only unchanged retained media may retain an already observed MIME alias.
      if (row.file.endsWith('.webm') && old?.sha256 === row.sha256 && old.mime === 'audio/webm') expected.push('audio/webm');
      assert.ok(expected.includes(mime), 'Static HTTPS MIME mismatch');
    }
    observed.push({ file: row.file, sha256: row.sha256, mime });
  }
  return observed;
}

export async function observePublishedBaseline(origin, rows, reader = readPublic) {
  // These aliases are restricted to the actual old, hash-verified static inventory.
  const aliases = new Map(rows.filter(row => row.file.endsWith('.webm'))
    .map(row => [row.file, { sha256: row.sha256, mime: 'audio/webm' }]));
  return verifyPublishedStatic(origin, rows, aliases, reader);
}
