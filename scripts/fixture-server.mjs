import { createServer } from 'node:https';
import { readFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, resolve, extname } from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { WebSocketServer, WebSocket } from 'ws';

// DEMO-only localhost test harness. Never imported by or included in the production application.
export async function startFixture({ releaseDirectory, imageTurn = false, staticCacheControl = 'no-store', originHostname = '127.0.0.1' } = {}) {
  if (!['127.0.0.1', 'localhost'].includes(originHostname)) throw new Error('Fixture hostname must remain local');
  const root = fileURLToPath(new URL('..', import.meta.url));
  const build = readFileSync(join(root, 'releases/current-build.txt'), 'utf8').trim();
  const release = releaseDirectory || join(root, 'releases', build);
  const tls = join(root, 'output/playwright/tls');
  mkdirSync(tls, { recursive: true });
  if (!existsSync(join(tls, 'fixture-key.pem'))) execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', join(tls, 'fixture-key.pem'), '-out', join(tls, 'fixture-cert.pem'), '-days', '2', '-subj', '/CN=localhost', '-addext', 'subjectAltName=IP:127.0.0.1,DNS:localhost'], { stdio: 'ignore' });
  const state = { auth: true, ticketSequence: 0, tickets: new Map(), submissions: 0, answers: [], methods: [],
    sessions: new Map(), open: new Map(), nextBuild: build, staticRelease: release, indexRelease: null,
    staticRequests: [], epoch: 'DEMO-epoch-1', truncated: false, sockets: new Set(), forceWsFailure: false,
    richNavigation: false, projectDelayMs: 0, projectSessionsDelayMs: 0, failProjects: false,
    imageTurn, imageAttachMode: '', imagePromptMode: '', imageDetachMode: '', imageAttachDelayMs: 0, imageCounter: 0,
    networkOffline: false, staticDelayMs: 0, featureMethods: [], httpRequests: [], wsUpgrades: [] };
  let origin = '';
  // Names only: a server-side witness is needed where WebKit conceals Cookie
  // request headers. Never retain cookie values, ticket query strings or frames.
  function cookieNames(request) {
    return String(request.headers.cookie || '').split(';').map(item => item.trim().split('=', 1)[0])
      .filter(name => /^DEMO_[AB]_session$/.test(name));
  }
  function session(profile) {
    if (!state.sessions.has(profile)) state.sessions.set(profile, { live: `DEMO-live-${profile}`, durable: `DEMO-durable-${profile}`, running: false, seq: 0, events: [],
      images: [], messages: [{ role: 'assistant', text: 'DEMO 保存済み回答。実サーバーには接続していません。', row_id: 1 }] });
    return state.sessions.get(profile);
  }
  function snapshot(profile) {
    const item = session(profile);
    return { session_id: item.live, stored_session_id: item.durable, message_count: item.messages.length, messages: [...item.messages],
      running: item.running, info: { running: item.running, stored_session_id: item.durable, title: 'DEMO会話' },
      open_requests: [...state.open.values()].filter(request => request.params.session_id === item.live) };
  }
  function navigation(profile) {
    const item = session(profile);
    const recent = { id: item.durable, title: `DEMO会話 ${profile}`, source: 'tui', message_count: item.messages.length, last_active: 1791040000, profile };
    const project = (id, label, rows, flags = {}) => ({ id, label, sessionCount: rows.length, sessionIds: rows.map(row => row.id),
      lastActive: rows[0]?.last_active || 0, previewSessions: rows.slice(0, 3),
      repos: [{ id: 'DEMO-repo', label: 'DEMO作業先', groups: [{ id: 'DEMO-main', label: 'DEMO-main', sessions: rows }] }], ...flags });
    if (!state.richNavigation) return { rows: [recent], projects: [project('DEMO-home', 'Home', [recent], { isNoProject: true })] };
    const plan = [recent, { ...recent, id: `DEMO-plan-${profile}`, title: 'DEMO 日本語の計画', last_active: 1791030000 }];
    const research = [{ ...recent, id: `DEMO-research-${profile}`, title: 'DEMO 調査メモ', last_active: 1791020000 }];
    const home = [{ ...recent, id: `DEMO-home-session-${profile}`, title: 'DEMO プロジェクトなしの会話', last_active: 1791010000 }];
    return { rows: [...plan, ...research, ...home], projects: [project('DEMO-plan', 'DEMO 計画', plan),
      project('DEMO-research', 'DEMO 調査', research, { isAuto: true }), project('DEMO-home', 'Home', home, { isNoProject: true })] };
  }
  const json = (response, status, data) => { response.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' }); response.end(JSON.stringify(data)); };
  const server = createServer({ key: readFileSync(join(tls, 'fixture-key.pem')), cert: readFileSync(join(tls, 'fixture-cert.pem')) }, async (request, response) => {
    // Test-only transport failure. Renderer, Service Worker and cache stay real.
    if (state.networkOffline) { request.destroy(); response.destroy(); return; }
    const url = new URL(request.url || '/', origin || 'https://127.0.0.1');
    if (state.httpRequests.length < 1000) state.httpRequests.push({ method: request.method, path: url.pathname, cookieNames: cookieNames(request) });
    if (url.pathname === '/api/status') return json(response, 200, { version: 'DEMO-fixture-e8c97320', auth_required: true });
    if (url.pathname === '/api/auth/me') return json(response, state.auth ? 200 : 401, state.auth ? { user_id: 'DEMO-owner' } : { detail: 'Unauthorized' });
    if (url.pathname === '/api/profiles') return json(response, state.auth ? 200 : 401, { profiles: [{ name: 'default' }, { name: 'DEMO-secondary' }] });
    if (url.pathname === '/api/auth/ws-ticket') {
      if (!state.auth) return json(response, 401, {});
      const ticket = `DEMO-ticket-${++state.ticketSequence}`;
      state.tickets.set(ticket, Date.now() + 30000); return json(response, 200, { ticket, ttl_seconds: 30 });
    }
    if (url.pathname === '/__DEMO_image_queue') return json(response, 200, [...session(url.searchParams.get('profile') || 'default').images]);
    if (url.pathname === '/auth/logout') { state.auth = false; return json(response, 200, { ok: true }); }
    if (url.pathname === '/login') {
      response.writeHead(200, { 'content-type': 'text/html', 'cache-control': 'no-store' });
      return response.end('<!doctype html><html lang="ja"><title>DEMO認証画面</title><h1>DEMO認証画面</h1><p>fixture専用。実資格情報は入力しないでください。</p></html>');
    }
    if (!url.pathname.startsWith('/hermes-remote-web/')) return json(response, 404, {});
    if (url.pathname.endsWith('/build.json')) return json(response, 200, { buildId: state.nextBuild });
    const relativePath = decodeURIComponent(url.pathname.slice('/hermes-remote-web/'.length) || 'index.html');
    const directory = relativePath === 'index.html' && state.indexRelease ? state.indexRelease : state.staticRelease;
    const file = resolve(directory, relativePath);
    if (!file.startsWith(directory + '/') || !existsSync(file)) return json(response, 404, {});
    const type = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png' }[extname(file)] || 'text/plain';
    state.staticRequests.push(relativePath);
    response.writeHead(200, { 'content-type': type, 'cache-control': staticCacheControl });
    const contents = readFileSync(file);
    if (state.staticDelayMs) setTimeout(() => response.end(contents), state.staticDelayMs);
    else response.end(contents);
  });
  const connections = new Set();
  server.on('connection', socket => {
    connections.add(socket); socket.on('close', () => connections.delete(socket));
    if (state.networkOffline) socket.destroy();
  });
  const wss = new WebSocketServer({ noServer: true, handleProtocols: () => 'hermes-gateway-v1' });
  server.on('upgrade', (request, socket, head) => {
    if (state.networkOffline) { socket.destroy(); return; }
    if (state.wsUpgrades.length < 100) state.wsUpgrades.push({ cookieNames: cookieNames(request) });
    const protocols = String(request.headers['sec-websocket-protocol'] || '').split(',').map(item => item.trim());
    const token = protocols.find(item => item.startsWith('hermes-gateway-ticket.'))?.slice('hermes-gateway-ticket.'.length);
    const expires = state.tickets.get(token) || 0;
    state.tickets.delete(token);
    if (state.forceWsFailure || request.headers.origin !== origin || !state.auth || !token || expires < Date.now() || !protocols.includes('hermes-gateway-v1')) {
      socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n'); return;
    }
    wss.handleUpgrade(request, socket, head, ws => wss.emit('connection', ws, request));
  });
  function wire(ws, frame) { if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(frame)); }
  function event(ws, profile, type, payload) {
    const item = session(profile);
    const frame = { type, session_id: item.live, seq: ++item.seq, payload };
    item.events.push(frame); wire(ws, { jsonrpc: '2.0', method: 'event', params: frame });
  }
  wss.on('connection', ws => {
    state.sockets.add(ws); ws.on('close', () => state.sockets.delete(ws));
    wire(ws, { jsonrpc: '2.0', method: 'event', params: { type: 'gateway.ready', payload: { heartbeat: true, replay_epoch: state.epoch } } });
    ws.on('message', data => {
      for (const line of String(data).split('\n').filter(Boolean)) {
        const frame = JSON.parse(line);
        const params = frame.params || {};
        const profile = params.profile || 'default';
        const item = session(profile);
        const reply = result => wire(ws, { jsonrpc: '2.0', id: frame.id, result });
        if (!frame.method && frame.id !== undefined) {
          const key = `${typeof frame.id}:${frame.id}`;
          const request = state.open.get(key);
          if (request) { state.answers.push({ method: request.method, response: frame.result || frame.error }); state.open.delete(key); event(ws, profile, 'request.cancel', { id: frame.id, reason: 'resolved' }); item.running = false; }
          continue;
        }
        state.methods.push(frame.method);
        if (frame.method === 'client.capabilities') reply({ server_requests: ['approval', 'clarify', 'sudo'], declines_not_shown: true });
        else if (frame.method === 'remote.app.capabilities') reply({ version: 1, principal_id: 'a'.repeat(64), methods: state.featureMethods, generation_allowed: true, generation_reason: '' });
        else if (frame.method === 'remote.notifications.unsubscribe_all' && state.featureMethods.includes(frame.method)) reply({ version: 1, removed: 0 });
        else if (frame.method === 'gateway.capabilities') reply({ per_session_exclusive_submit: true, remote_web_version: 1, ...(state.imageTurn ? { image_turn_version: 1 } : {}) });
        else if (frame.method === 'image.turn_capabilities') reply({ version: 1, enabled: state.imageTurn, model_vision: state.imageTurn ? true : null, reason: 'DEMO', max_raw_bytes: 5 * 1048576, max_frame_bytes: 8 * 1048576, max_text_bytes: 65536, max_edge: 8192, max_pixels: 16000000 });
        else if (frame.method === 'gateway.ping' || frame.method === 'ping') reply({ pong: true });
        else if (frame.method === 'session.list') reply({ sessions: navigation(profile).rows.slice(0, params.limit || 100) });
        else if (frame.method === 'projects.tree') {
          if (state.failProjects) wire(ws, { jsonrpc: '2.0', id: frame.id, error: { code: -32601, message: 'DEMO unsupported projects' } });
          else setTimeout(() => reply({ projects: navigation(profile).projects.map(project => ({ ...project,
            repos: project.repos.map(repo => ({ ...repo, groups: repo.groups.map(group => ({ ...group, sessions: [] })) })) })), active_id: 'DEMO-plan' }), state.projectDelayMs);
        }
        else if (frame.method === 'projects.project_sessions') {
          const project = navigation(profile).projects.find(project => project.id === params.project_id) || null;
          setTimeout(() => reply({ project }), state.projectSessionsDelayMs);
        }
        else if (frame.method === 'session.create' || frame.method === 'session.resume' || frame.method === 'session.activate') reply(snapshot(profile));
        else if (frame.method === 'session.events.since') reply({ events: item.events.filter(event => event.seq > (params.last_seen || 0)), latest_seq: item.seq, epoch: state.epoch,
          truncated: state.truncated, count: item.events.length, open_requests: [...state.open.values()].filter(request => request.params.session_id === item.live) });
        else if (frame.method === 'image.attach_bytes') {
          setTimeout(() => {
            if (state.imageAttachMode === 'reject') return wire(ws, { jsonrpc: '2.0', id: frame.id, error: { code: 4018, message: 'DEMO rejected' } });
            const path = `/DEMO/image-${++state.imageCounter}.png`; item.images.push(path);
            if (state.imageAttachMode === 'unknown') return ws.terminate();
            reply({ attached: true, path, count: item.images.length, bytes: Buffer.from(params.content_base64, 'base64').length });
          }, state.imageAttachDelayMs);
        }
        else if (frame.method === 'image.detach') {
          if (state.imageDetachMode === 'unknown') return ws.terminate();
          const before = item.images.length; item.images = item.images.filter(path => path !== params.path);
          reply({ detached: before !== item.images.length, count: item.images.length });
        }
        else if (frame.method === 'prompt.submit') {
          if (state.imagePromptMode === 'reject') { wire(ws, { jsonrpc: '2.0', id: frame.id, error: { code: 4009, message: 'DEMO busy' } }); continue; }
          item.images = [];
          state.submissions++; item.running = true; item.messages.push({ role: 'user', text: params.text, row_id: item.messages.length + 1 });
          if (params.text.includes('lose ack') || params.image && state.imagePromptMode === 'unknown') {
            ws.terminate();
            setTimeout(() => {
              item.running = false; item.messages.push({ role: 'assistant', text: 'DEMO 切断後に保存した結果', row_id: item.messages.length + 1 });
              for (const subscriber of state.sockets) event(subscriber, profile, 'message.complete', { text: 'DEMO 切断後に保存した結果', status: 'complete' });
            }, 300);
            continue;
          }
          reply({ status: 'streaming', user_row_id: item.messages.length, ...(params.image ? { image_turn: { receipt_id: 'DEMO-image-turn', format: params.image.filename.endsWith('.png') ? 'PNG' : 'JPEG', bytes: Buffer.from(params.image.content_base64, 'base64').length, width: 240, height: 160 } } : {}) });
          setTimeout(() => {
            event(ws, profile, 'message.start', {});
            event(ws, profile, 'tool.start', { tool_id: 'DEMO-tool', name: 'DEMO-tool', context: 'echo DEMO' });
            if (params.text.includes('approval') || params.text.includes('clarify') || params.text.includes('unsupported')) {
              const method = params.text.includes('approval') ? 'approval' : params.text.includes('clarify') ? 'clarify' : 'sudo';
              const request = { id: method === 'approval' ? 42 : `DEMO-${method}`, method, params: { session_id: item.live,
                ...(method === 'approval' ? { request_id: 'DEMO-native-approval', command: 'echo DEMO', description: 'DEMOだけの無害な要求', choices: ['once', 'session', 'always', 'deny'] } : method === 'clarify'
                  ? { questions: [{ qid: 'q0', question: 'DEMO 受理済み' }, { qid: 'q1', question: 'DEMO 選択', choices: ['A', 'B'], multi_select: true }, { qid: 'q2', question: 'DEMO 自由回答' }], answers: { q0: 'accepted' } } : { command: 'DEMO unsupported' }) } };
              state.open.set(`${typeof request.id}:${request.id}`, request); wire(ws, { jsonrpc: '2.0', ...request });
            } else if (!params.text.includes('hold')) {
              const answer = params.text.includes('long') ? `DEMO 長いコードの回答\n\n<script>window.__DEMO_xss=1</script>\n[DEMO bad](javascript:alert(1))\n![DEMO image](https://untrusted.invalid/DEMO.png)\n\n\`\`\`text\n${'DEMO code '.repeat(300)}\n\`\`\`` : 'DEMO 日本語の回答です。';
              event(ws, profile, 'message.delta', { text: answer.slice(0, 9) });
              setTimeout(() => {
                event(ws, profile, 'message.delta', { text: answer.slice(9) });
                event(ws, profile, 'tool.complete', { tool_id: 'DEMO-tool', name: 'DEMO-tool', result_text: 'DEMO completed' });
                item.running = false; item.messages.push({ role: 'assistant', text: answer, row_id: item.messages.length + 1 });
                event(ws, profile, 'message.complete', { text: answer, status: 'complete' });
              }, 300);
            }
          }, 30);
        } else if (frame.method === 'session.interrupt') {
          reply({ status: 'interrupted', interrupted: true });
          setTimeout(() => { item.running = false; event(ws, profile, 'message.complete', { text: 'DEMO 停止した結果', status: 'interrupted' }); }, 300);
        } else wire(ws, { jsonrpc: '2.0', id: frame.id, error: { code: -32601, message: 'DEMO unknown method' } });
      }
    });
  });
  const boundedTransport = async action => {
    let timer;
    try {
      return await Promise.race([action(), new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error('DEMO owned fixture transport timed out')), 2500);
      })]);
    } finally { clearTimeout(timer); }
  };
  const listen = port => boundedTransport(() => new Promise((resolve, reject) => {
    const onError = error => { server.removeListener('listening', onListening); reject(error); };
    const onListening = () => { server.removeListener('error', onError); resolve(); };
    server.once('error', onError); server.once('listening', onListening);
    server.listen(port, '127.0.0.1');
  }));
  const stopListening = () => boundedTransport(() => new Promise((resolve, reject) => {
    if (server.listening) server.close(error => error ? reject(error) : resolve());
    else resolve();
    // Own sockets only, including upgrades and incomplete TLS handshakes.
    // closeAllConnections alone does not close upgraded WebSockets.
    for (const ws of state.sockets) ws.terminate();
    for (const socket of connections) socket.destroy();
    server.closeAllConnections();
  }));
  await listen(0);
  const port = server.address().port;
  origin = `https://${originHostname}:${port}`;
  let closing; let transportFailure; let transportTransition = Promise.resolve();
  return { origin, build, state, setNetworkOffline(offline) {
    if (typeof offline !== 'boolean') return Promise.reject(new Error('DEMO invalid fixture network state'));
    if (closing) return Promise.reject(new Error('DEMO owned fixture is closed'));
    const next = transportTransition.then(async () => {
      if (closing) throw new Error('DEMO owned fixture is closed');
      if (transportFailure) throw transportFailure;
      if (state.networkOffline === offline && server.listening === !offline) return;
      if (offline) {
        state.networkOffline = true;
        await stopListening();
      } else {
        // Restore this exact origin only. A failed bind is not an online state.
        await listen(port);
        state.networkOffline = false;
      }
    });
    // Preserve a failed transition. Only cleanup can proceed; no implicit retry.
    transportTransition = next.catch(error => { transportFailure = error; });
    return next;
  }, async close() {
    if (!closing) closing = transportTransition.then(async () => {
      state.networkOffline = true;
      await stopListening();
      if (transportFailure) throw transportFailure;
    });
    await closing;
  } };
}

if (process.argv.includes('--serve')) {
  const fixture = await startFixture();
  console.log(`DEMO FIXTURE ONLY — no real Hermes: ${fixture.origin}/hermes-remote-web/\nSelf-signed localhost certificate; this is not a deployed application URL.`);
  process.on('SIGINT', async () => { await fixture.close(); process.exit(0); });
  process.on('SIGTERM', async () => { await fixture.close(); process.exit(0); });
}
