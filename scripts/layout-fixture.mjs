import { createHash } from 'node:crypto';

// Only additional UI panel responses are synthetic. The existing loopback
// fixture still owns auth, fresh tickets, actual WSS and ordinary conversations.
export const UI_METHODS = [
  'remote.sessions.list', 'remote.session.metadata', 'remote.session.organize', 'remote.session.branch_from_row',
  'remote.templates.list', 'remote.templates.put', 'remote.templates.remove', 'remote.info.models', 'remote.info.snapshot',
  'remote.info.commands', 'remote.info.cron', 'remote.info.activity', 'remote.files.roots', 'remote.files.list',
  'remote.files.read', 'remote.artifacts.list', 'remote.artifacts.read', 'remote.notifications.status',
  'remote.notifications.unsubscribe_all', 'remote.project.create_session',
];
const stamp = 1791040000;
export const DEMO_DRAFT = 'DEMO 日本語の下書き\n二行目を保持します。';
export const DEMO_LONG_PROFILE = 'DEMO_検修用の長いプロファイル名_' + 'identifier'.repeat(12);
export const DEMO_HISTORY = Array.from({ length: 65 }, (_, i) => ({ row_id: i + 1, role: i % 2 ? 'user' : 'assistant',
  text: i === 64 ? 'DEMO 最後の回答\n\n# 見出し\n\n|項目|内容|\n|---|---|\n|DEMO|日本語の合成資料|\n\n```text\n' + 'DEMO_LONG_IDENTIFIER_'.repeat(150) + '\n```\n\n[DEMO link](https://example.invalid/DEMO)'
    : `DEMO_${i} 合成会話の本文と検索語\n${'日本語の検修用本文です。'.repeat(8)}` }));
const name = (kind, i, last) => i === last ? `DEMO-LAST-${kind}` : `DEMO-${kind}-${i}-${'long_identifier_'.repeat(14)}`;
const text = 'DEMO_FILE_ONLY 合成ファイル内容\n```text\n' + 'DEMO_CODE_'.repeat(100) + '\n```';
const artifactText = 'DEMO_ARTIFACT_ONLY 正式metadataの合成成果物\n```text\n' + 'DEMO_ARTIFACT_CODE_'.repeat(80) + '\n```';
const hash = value => createHash('sha256').update(value).digest('hex');
export function seedSession(fixture) {
  fixture.state.featureMethods = [...UI_METHODS]; fixture.state.richNavigation = true;
  fixture.state.sessions.set('default', { live: 'DEMO-live-default', durable: 'DEMO-durable-default', running: false, seq: 0, events: [], images: [], messages: structuredClone(DEMO_HISTORY) });
  fixture.state.sessions.set(DEMO_LONG_PROFILE, { live: `DEMO-live-${DEMO_LONG_PROFILE}`, durable: `DEMO-durable-${DEMO_LONG_PROFILE}`, running: false, seq: 0, events: [], images: [], messages: structuredClone(DEMO_HISTORY) });
}

export async function installFeatureFixture(context, fixture) {
  const witness = { kind: 'SYNTHETIC_UI_FEATURE_RESPONSE_ONLY', methods: [], blockedWrites: 0, outsideSockets: 0, mode: 'long', delayMs: 0, generationAllowed: false, holdStop: false, heldStopFrames: 0 };
  const info = (method, params) => {
    const envelope = { version: 1, profile: params.profile || 'default', session_id: params.session_id || null };
    if (method === 'remote.info.models') return { ...envelope, revision: 'DEMO-revision', model: 'DEMO-model', provider: 'DEMO-provider', api_mode: 'DEMO', endpoint_origin: null,
      scope: 'configured_same_route', truncated: true, rows: Array.from({ length: 100 }, (_, i) => ({ model: i ? name('MODEL', i, 99) : 'DEMO-model', provider: 'DEMO-provider',
        current: !i, listed: true, credential_present: null, response_confirmed: null, selectable: false, reason: 'limits_unknown' })) };
    if (method === 'remote.info.snapshot') return { ...envelope, model: 'DEMO-model', provider: 'DEMO-provider', api_mode: 'DEMO', tools_state: 'unknown', skills_state: 'unknown', mcp_state: 'unknown',
      ...Object.fromEntries(['tools', 'skills', 'mcp'].map(kind => [kind, Array.from({ length: 100 }, (_, i) => ({ name: name(kind.toUpperCase(), i, 99), state: 'unknown' }))])),
      usage: { source: 'unknown', actual_cost_usd: null, estimated_cost_usd: null }, observed_at: stamp, truncated: true };
    if (method === 'remote.info.commands') return { ...envelope, skills_state: 'available', truncated: true, rows: Array.from({ length: 50 }, (_, i) => ({ text: name('SKILL', i, 49),
      description: 'DEMO 説明文。'.repeat(30) + 'long_'.repeat(40), category: 'DEMO', kind: 'skill', support: i ? 'management' : 'draft', insertable: !i })) };
    if (method === 'remote.info.cron') return { ...envelope, state: 'available', history_state: 'available', truncated: true,
      jobs: Array.from({ length: 50 }, (_, i) => ({ id: `DEMO-job-${i}`, name: name('CRON', i, 49), schedule: 'DEMO 固定予定 '.repeat(10), timezone: 'America/New_York', enabled: true,
        next_run_at: '2026-10-07T09:00:00-04:00', next_run_jst: '2026-10-07T22:00:00+09:00', last_run_at: null, last_run_jst: null, last_status: null })),
      history: Array.from({ length: 50 }, (_, i) => ({ id: `DEMO-run-${i}`, job_id: `DEMO-job-${i}`, status: name('CRON-HISTORY', i, 49), started_at: 'DEMO', finished_at: 'DEMO', started_jst: 'DEMO', finished_jst: 'DEMO' })) };
    if (method === 'remote.info.activity') return { ...envelope, stored_state: 'available', observed_at: stamp, truncated: true, rows: Array.from({ length: 50 }, (_, i) => ({ durable_id: `DEMO-activity-${i}`,
      live_id: null, title: name('ACTIVITY', i, 49), state: 'waiting_input', open_request_count: 1, last_active: stamp })) };
    const content = (value=text) => ({ name: name('CONTENT', 1, 99), mime: 'text/markdown', bytes: Buffer.byteLength(value), etag: hash(value), sha256: hash(value), text:value, content_base64: null, max_bytes: 1048576, truncated: false });
    if (method === 'remote.files.roots') return { ...envelope, max_bytes: 1048576, truncated: false, roots: [{ id: 'DEMO-root', project_id: 'DEMO-plan', name: 'DEMO 登録作業先 '.repeat(12), folder_name: 'DEMO-folder-'.repeat(20) }] };
    if (method === 'remote.files.list') return { ...envelope, root_id: params.root_id, path: params.path, max_bytes: 1048576, truncated: true, rows: Array.from({ length: 100 }, (_, i) => ({
      name: name('FILE', i, 99), path: `DEMO-${i}.md`, directory: false, bytes: Buffer.byteLength(text), mime: 'text/markdown', etag: hash(text), readable: i % 8 !== 7, reason: i % 8 === 7 ? 'size_limit' : '' })) };
    if (method === 'remote.files.read') return { ...envelope, root_id: params.root_id, path: params.path, content: content() };
    if (method === 'remote.artifacts.list') return { ...envelope, max_bytes: 1048576, truncated: true, rows: Array.from({ length: 100 }, (_, i) => ({ id: `DEMO-artifact-${i}`, name: name('ARTIFACT', i, 99),
      mime: 'text/markdown', bytes: Buffer.byteLength(artifactText), etag: hash(artifactText), producer: 'write_file', registered_at: stamp })) };
    if (method === 'remote.artifacts.read') return { ...envelope, artifact_id: params.artifact_id, content: content(artifactText) };
    if (method === 'remote.sessions.list') return { sessions: [{ session_id: 'DEMO-durable-default', title: 'DEMO 保存会話', pinned: false, archived: false, version: 'DEMO-v1', started_at: stamp, parent_session_id: null }], next_cursor: null, order: 'created_desc', scope: 'owned_profile_sessions', limit: 50, snapshot_time: stamp };
    if (method === 'remote.session.metadata') return { session: { session_id: params.session_id, title: 'DEMO 会話名 '.repeat(20), pinned: false, archived: false, version: 'DEMO-v1' } };
    if (method === 'remote.templates.list') return { templates: Array.from({ length: 50 }, (_, i) => ({ id: `DEMO-template-${i}`, name: name('TEMPLATE', i, 49).slice(0, 100), category: 'DEMO', body: 'DEMO 定型文を下書きへ挿入します。', version: 1, updated_at: stamp })), limit: 50, body_limit: 8000, storage_scope: 'authenticated_owner_profile_server' };
    if (method === 'remote.notifications.status') return { available:false, reason:'DEMO 無同意検修', public_key:null, subscriptions:[], scope:'authenticated_owner_profile_session',ttl_seconds:2592000,max_subscriptions:8 };
    return null;
  };
  await context.routeWebSocket('**', route => {
    const url=new URL(route.url());
    if(url.origin!==fixture.origin.replace('https:','wss:')||url.pathname!=='/api/ws'){
      witness.outsideSockets++;route.close({code:1008,reason:'DEMO fixture forbids external WebSockets'});return;
    }
    const server = route.connectToServer();
    const capabilityIds = new Set();
    const stopIds = new Set(), held = [];
    witness.releaseStop = () => { for(const line of held.splice(0))route.send(line);witness.heldStopFrames=0;witness.holdStop=false; };
    server.onMessage(message => {
      for (const line of String(message).split('\n').filter(Boolean)) {
        const frame = JSON.parse(line), key = `${typeof frame.id}:${frame.id}`;
        const stopCompletion=frame.method==='event'&&frame.params?.type==='message.complete'&&frame.params?.payload?.status==='interrupted';
        if(witness.holdStop&&(stopIds.delete(key)||stopCompletion)){held.push(line);witness.heldStopFrames=held.length;continue;}
        if (capabilityIds.delete(key) && frame.result) {
          frame.result.generation_allowed = witness.generationAllowed;
          frame.result.generation_reason = witness.generationAllowed ? '' : 'DEMO この検証profileは実生成が未許可です。閲覧・端末内編集だけが利用できます。本文や画像・資料を自動送信しません。';
          route.send(JSON.stringify(frame));
        } else route.send(line);
      }
    });
    route.onMessage(message => {
      for (const line of String(message).split('\n').filter(Boolean)) {
        const frame = JSON.parse(line);
        if (frame.method === 'remote.app.capabilities') capabilityIds.add(`${typeof frame.id}:${frame.id}`);
        if (frame.method === 'session.interrupt'&&witness.holdStop) stopIds.add(`${typeof frame.id}:${frame.id}`);
        if (!UI_METHODS.includes(frame.method) || frame.method === 'remote.notifications.unsubscribe_all') { server.send(line); continue; }
        witness.methods.push(frame.method);
        const result = info(frame.method, frame.params || {});
        if (result) {
          const send = () => route.send(JSON.stringify({ jsonrpc: '2.0', id: frame.id, ...(witness.mode === 'error' ? { error: { code: -32000, message: 'DEMO read failure' } } : { result: witness.mode === 'empty' && result.rows ? { ...result, rows: [] } : result }) }));
          if (witness.delayMs) setTimeout(send, witness.delayMs); else send();
        } else {
          witness.blockedWrites++;
          route.send(JSON.stringify({ jsonrpc: '2.0', id: frame.id, error: { code: -32000, message: 'DEMO UI geometry does not authorize a feature write' } }));
        }
      }
    });
  });
  return witness;
}
