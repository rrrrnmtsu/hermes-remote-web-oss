import test from 'node:test';
import assert from 'node:assert/strict';
import { connect, createServer } from 'node:net';
import { once } from 'node:events';
import { get } from 'node:https';
import { startFixture } from './fixture-server.mjs';
import { WebSocket } from 'ws';

async function fixtureJson(url) {
  return await new Promise((resolve, reject) => {
    const request = get(url, { rejectUnauthorized: false, agent: false, timeout: 1500 }, response => {
      let body = '';
      response.setEncoding('utf8'); response.on('data', chunk => { body += chunk; });
      response.once('end', () => resolve(JSON.parse(body)));
    });
    request.once('error', reject); request.once('timeout', () => request.destroy(new Error('DEMO fixture HTTP timed out')));
  });
}

async function openFixtureWebSocket(fixture) {
  const { ticket } = await fixtureJson(`${fixture.origin}/api/auth/ws-ticket`);
  const ws = new WebSocket(fixture.origin.replace('https:', 'wss:') + '/ws',
    ['hermes-gateway-v1', `hermes-gateway-ticket.${ticket}`], { rejectUnauthorized: false, origin: fixture.origin });
  await once(ws, 'open');
  return ws;
}

async function refusedConnection(origin) {
  const url = new URL(origin);
  return await new Promise((resolve, reject) => {
    const socket = connect({ host: url.hostname, port: Number(url.port) });
    socket.setTimeout(1500);
    socket.once('connect', () => { socket.destroy(); reject(new Error('DEMO offline listener accepted TCP')); });
    socket.once('error', error => { socket.destroy(); resolve(error.code); });
    socket.once('timeout', () => { socket.destroy(); reject(new Error('DEMO TCP failure timed out')); });
  });
}

test('owned localhost fixture teardown closes incomplete TLS handshakes without hanging', { timeout: 5000 }, async () => {
  const fixture = await startFixture();
  const url = new URL(fixture.origin), socket = connect({ host: url.hostname, port: Number(url.port) });
  socket.on('error', () => undefined);
  try {
    await once(socket, 'connect');
    let timeout;
    const closed = fixture.close().then(() => 'closed');
    const deadline = new Promise(resolve => { timeout = setTimeout(() => resolve('hung'), 1500); });
    const status = await Promise.race([closed, deadline]); clearTimeout(timeout);
    assert.equal(status, 'closed'); await fixture.close();
  } finally { socket.destroy(); await fixture.close(); }
});

test('origin witness retains only synthetic cookie names and drops query strings and values', async () => {
  const fixture = await startFixture();
  try {
    await new Promise((resolve, reject) => {
      const request = get(`${fixture.origin}/api/status?ticket=DEMO-not-recorded`, {
        rejectUnauthorized: false, headers: { cookie: 'DEMO_A_session=DEMO-not-recorded; other=DEMO-private' },
      }, response => { response.resume(); response.once('end', resolve); });
      request.once('error', reject);
    });
    assert.deepEqual(fixture.state.httpRequests, [{ method: 'GET', path: '/api/status', cookieNames: ['DEMO_A_session'] }]);
    assert.equal(JSON.stringify(fixture.state.httpRequests).includes('DEMO-not-recorded'), false);
  } finally { await fixture.close(); }
});

test('offline closes the real HTTPS and WS listener and resumes the exact same origin', { timeout: 8000 }, async () => {
  const fixture = await startFixture();
  let ws;
  try {
    ws = await openFixtureWebSocket(fixture);
    const originalOrigin = fixture.origin;
    const witnessed = { http: fixture.state.httpRequests.length, ws: fixture.state.wsUpgrades.length };
    const closed = once(ws, 'close');
    await fixture.setNetworkOffline(true);
    await closed;
    assert.equal(fixture.state.networkOffline, true);
    assert.equal(await refusedConnection(fixture.origin), 'ECONNREFUSED');
    await assert.rejects(fixtureJson(`${fixture.origin}/api/status`), { code: 'ECONNREFUSED' });
    assert.deepEqual({ http: fixture.state.httpRequests.length, ws: fixture.state.wsUpgrades.length }, witnessed,
      'unreachable requests must not reach HTTP or WS handlers');
    await fixture.setNetworkOffline(true);
    await fixture.setNetworkOffline(false);
    assert.equal(fixture.origin, originalOrigin); assert.equal(fixture.state.networkOffline, false);
    assert.equal((await fixtureJson(`${fixture.origin}/api/status`)).auth_required, true);
    ws = await openFixtureWebSocket(fixture);
    assert.equal(ws.readyState, WebSocket.OPEN);
    assert.equal(fixture.state.submissions, 0); assert.deepEqual(fixture.state.answers, []);
  } finally { ws?.terminate(); await fixture.close(); }
});

test('concurrent offline transitions are serialized and cleanup also works while offline', { timeout: 8000 }, async () => {
  const fixture = await startFixture();
  try {
    await Promise.all([fixture.setNetworkOffline(true), fixture.setNetworkOffline(false), fixture.setNetworkOffline(true)]);
    assert.equal(fixture.state.networkOffline, true);
    assert.equal(await refusedConnection(fixture.origin), 'ECONNREFUSED');
    await fixture.close(); await fixture.close();
    await assert.rejects(fixture.setNetworkOffline(false), /fixture is closed/);
    assert.equal(await refusedConnection(fixture.origin), 'ECONNREFUSED');
  } finally { await fixture.close(); }
});

test('an occupied original port fails closed without retry or an alternative origin', { timeout: 8000 }, async () => {
  const fixture = await startFixture();
  const blocker = createServer();
  let failed = false;
  try {
    await fixture.setNetworkOffline(true);
    const originalOrigin = fixture.origin, port = Number(new URL(originalOrigin).port);
    await new Promise((resolve, reject) => { blocker.once('error', reject); blocker.listen(port, '127.0.0.1', resolve); });
    await assert.rejects(fixture.setNetworkOffline(false), { code: 'EADDRINUSE' }); failed = true;
    assert.equal(fixture.state.networkOffline, true); assert.equal(fixture.origin, originalOrigin);
    await assert.rejects(fixture.setNetworkOffline(false), { code: 'EADDRINUSE' });
    assert.equal(fixture.state.httpRequests.length, 0); assert.equal(fixture.state.wsUpgrades.length, 0);
    await assert.rejects(fixture.close(), { code: 'EADDRINUSE' });
  } finally {
    if (blocker.listening) await new Promise(resolve => blocker.close(resolve));
    if (failed) await assert.rejects(fixture.close(), { code: 'EADDRINUSE' });
    else await fixture.close();
  }
});
