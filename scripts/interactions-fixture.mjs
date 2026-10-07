import { createHash } from 'node:crypto';
import { seedSession, DEMO_DRAFT } from './layout-fixture.mjs';

// These memory-only RPC responses test UI transitions, not real Hermes ownership
// or storage. Authentication, fresh tickets and ordinary WSS still use Node.
export { DEMO_DRAFT };
export const INTERACTION_METHODS = [
  'remote.sessions.list', 'remote.session.metadata', 'remote.session.organize',
  'remote.session.branch_from_row', 'remote.templates.list', 'remote.templates.put', 'remote.templates.remove',
  'remote.info.models', 'remote.session.model_set', 'remote.info.snapshot', 'remote.info.commands',
  'remote.info.cron', 'remote.info.activity', 'remote.files.roots', 'remote.files.list', 'remote.files.read',
  'remote.artifacts.list', 'remote.artifacts.read', 'remote.notifications.status', 'remote.notifications.unsubscribe_all',
  'remote.project.create_session',
];
const timestamp = 1791040000;
const sha = value => createHash('sha256').update(value).digest('hex');
export async function installInteractionFixture(context, fixture) {
  seedSession(fixture); fixture.state.featureMethods = [...INTERACTION_METHODS];
  const pending = new Map(), held = new Map(), errors = new Set(), empties = new Set(), delays = new Map();
  let revision = 1, model = 'DEMO-model';
  const metadata = { session_id: 'DEMO-durable-default', title: 'DEMO 保存会話', pinned: false, archived: false, version: 'DEMO-v1' };
  const templates = [{ id: 'DEMO-template-1', name: 'DEMO 既存定型文', category: 'DEMO', body: 'DEMO 定型文の合成本文。', version: 1, updated_at: timestamp }];
  const witness = { stage: 'SYNTHETIC_UI_CONTRACT_RESPONSES_ONLY', methods: [], writes: [], rejected: 0, outsideSockets: 0,
    generationAllowed: false, modelPolicy: 'known', httpOrProviderUploads: 0, pendingReads: 0,
    hold(method) { held.set(method, true); },
    release(method) { held.delete(method); for (const respond of pending.get(method) || []) respond(); pending.delete(method); },
    fail(method, value = true) { if (value) errors.add(method); else errors.delete(method); },
    empty(method, value = true) { if (value) empties.add(method); else empties.delete(method); },
    delay(method, milliseconds) { if (milliseconds) delays.set(method, milliseconds); else delays.delete(method); },
    releaseAll() { for (const method of held.keys()) this.release(method); },
    counters() { return { methods: this.methods.length, syntheticFeatureWrites: this.writes.length, rejected: this.rejected, outsideSockets: this.outsideSockets, pendingReads: [...pending.values()].reduce((count, list) => count + list.length, 0) }; },
  };
  function reply(method, params) {
    if (params.profile !== 'default' && params.profile !== 'DEMO-secondary') throw new Error('scope_rejected');
    const profile = params.profile || 'default'; const current = fixture.state.sessions.get(profile);
    const envelope = { version: 1, profile, session_id: params.session_id || null };
    const blank = empties.has(method);
    const content = (name, text) => ({ name, mime: 'text/markdown', bytes: Buffer.byteLength(text), etag: sha(text), sha256: sha(text), text, content_base64: null, max_bytes: 1048576, truncated: false });
    const fileText = '# DEMO_FILE_ONLY\n\n合成ファイルの内容です。\n\n```text\n' + 'DEMO_CODE_'.repeat(50) + '\n```';
    const artifactText = '# DEMO_ARTIFACT_ONLY\n\n前のファイルと異なる正式合成果物です。';
    switch (method) {
      case 'remote.sessions.list': {
        const rows = [{ ...metadata, session_id: current?.durable || metadata.session_id, started_at: timestamp, parent_session_id: null }];
        return { sessions: blank || (params.query && !metadata.title.includes(params.query)) ? [] : params.cursor ? [{ ...rows[0], session_id: 'DEMO-durable-page2', title: 'DEMO 第二ページ', started_at: timestamp - 1 }] : rows,
          next_cursor: blank || params.cursor ? null : 'DEMO-page-2', order: 'created_desc', scope: 'owned_profile_sessions', limit: 50, snapshot_time: timestamp };
      }
      case 'remote.session.metadata': return { session: { ...metadata, session_id: params.session_id } };
      case 'remote.session.organize': {
        if (params.expected_version !== metadata.version) throw new Error('version_conflict');
        for (const field of ['title', 'pinned', 'archived']) if (field in params) metadata[field] = params[field];
        metadata.version = `DEMO-v${++revision}`; return { session: { ...metadata, session_id: params.session_id } };
      }
      case 'remote.templates.list': return { templates: blank ? [] : structuredClone(templates), limit: 50, body_limit: 8000, storage_scope: 'authenticated_owner_profile_server' };
      case 'remote.templates.put': {
        let item = templates.find(row => row.id === params.id);
        if (params.id && (!item || item.version !== params.expected_version)) throw new Error('version_conflict');
        if (!item) { item = { id: `DEMO-template-${++revision}`, version: 0 }; templates.push(item); }
        Object.assign(item, { name: params.name.trim(), category: params.category, body: params.body, version: item.version + 1, updated_at: timestamp });
        return { template: { ...item } };
      }
      case 'remote.templates.remove': {
        const index = templates.findIndex(row => row.id === params.id && row.version === params.expected_version);
        if (index < 0) throw new Error('version_conflict'); templates.splice(index, 1); return { removed: params.id, version: params.expected_version };
      }
      case 'remote.session.branch_from_row': {
        const item = fixture.state.sessions.get(profile); if (!item || !['branch', 'edit', 'regenerate'].includes(params.mode) || !Number.isSafeInteger(params.row_id)) throw new Error('branch_rejected');
        const id = `DEMO-branch-${++revision}`; item.durable = id;
        return { stored_session_id: id, parent_session_id: params.session_id, source_row_id: params.row_id, message_count: item.messages.length, draft: params.mode === 'branch' ? '' : 'DEMO 分岐した下書き', mode: params.mode, generation_started: false, inheritance: 'visible_user_assistant_prefix_with_parent_system_context' };
      }
      case 'remote.info.models': return { ...envelope, revision: `DEMO-model-${revision}`, model, provider: 'DEMO-provider', api_mode: 'DEMO', endpoint_origin: null, scope: 'configured_same_route', truncated: false,
        rows: blank ? [] : ['DEMO-model', 'DEMO-alternate', 'DEMO-disabled'].map(value => ({ model: value, provider: 'DEMO-provider', current: model === value, listed: true, credential_present: null, response_confirmed: null, selectable: value !== 'DEMO-disabled' && witness.modelPolicy === 'known', reason: value === 'DEMO-disabled' || witness.modelPolicy !== 'known' ? 'limits_unknown' : '' })) };
      case 'remote.session.model_set': {
        if (params.expected_revision !== `DEMO-model-${revision}` || !['DEMO-model', 'DEMO-alternate'].includes(params.model) || witness.modelPolicy !== 'known') throw new Error('model_rejected');
        model = params.model; revision++; return reply('remote.info.models', params);
      }
      case 'remote.info.snapshot': return { ...envelope, model, provider: 'DEMO-provider', api_mode: 'DEMO', tools_state: 'unknown', skills_state: 'available', mcp_state: 'unknown', tools: [], skills: [{ name: 'DEMO Skill', state: 'available' }], mcp: [], usage: { source: 'unknown', actual_cost_usd: null, estimated_cost_usd: null }, observed_at: timestamp, truncated: false };
      case 'remote.info.commands': return { ...envelope, skills_state: 'available', truncated: false, rows: blank || params.query && !'DEMO Skill'.includes(params.query) ? [] : [
        { text: 'DEMO Skill', description: 'DEMO 対応Skill。挿入だけで送信しません。', category: 'DEMO', kind: 'skill', support: 'draft', insertable: true },
        { text: 'DEMO read-only', description: 'DEMO 管理専用。', category: 'DEMO', kind: 'command', support: 'management', insertable: false },
      ] };
      case 'remote.info.cron': return { ...envelope, state: 'available', history_state: 'available', truncated: false, jobs: blank ? [] : [{ id: 'DEMO-job', name: 'DEMO 予定', schedule: 'DEMO 固定予定', timezone: 'Asia/Tokyo', enabled: true, next_run_at: '2026-10-07T09:00:00+09:00', next_run_jst: '2026-10-07T09:00:00+09:00', last_run_at: null, last_run_jst: null, last_status: null }], history: blank ? [] : [{ id: 'DEMO-run', job_id: 'DEMO-job', status: 'DEMO 終了', started_at: 'DEMO', finished_at: 'DEMO', started_jst: 'DEMO', finished_jst: 'DEMO' }] };
      case 'remote.info.activity': return { ...envelope, observed_at: timestamp, stored_state: 'available', truncated: false, rows: blank ? [] : [{ durable_id: current?.durable || metadata.session_id, live_id: current?.live || null, title: 'DEMO 保存会話', state: 'idle', open_request_count: 0, last_active: timestamp }] };
      case 'remote.files.roots': return { ...envelope, max_bytes: 1048576, truncated: false, roots: blank ? [] : [{ id: 'DEMO-root', project_id: 'DEMO-plan', name: 'DEMO 登録作業先', folder_name: 'DEMO-folder' }] };
      case 'remote.files.list': return { ...envelope, root_id: params.root_id, path: params.path, max_bytes: 1048576, truncated: false, rows: blank ? [] : params.path ? [
        { name: 'DEMO-child.md', path: 'DEMO-folder/child.md', directory: false, bytes: Buffer.byteLength(fileText), mime: 'text/markdown', etag: sha(fileText), readable: true, reason: '' },
      ] : [
        { name: 'DEMO-folder', path: 'DEMO-folder', directory: true, bytes: null, mime: null, etag: null, readable: true, reason: '' },
        { name: 'DEMO-file.md', path: 'DEMO-file.md', directory: false, bytes: Buffer.byteLength(fileText), mime: 'text/markdown', etag: sha(fileText), readable: true, reason: '' },
        { name: 'DEMO-too-large.md', path: 'DEMO-too-large.md', directory: false, bytes: 1048577, mime: 'text/markdown', etag: sha(fileText), readable: false, reason: 'size_limit' },
      ] };
      case 'remote.files.read': return { ...envelope, root_id: params.root_id, path: params.path, content: content('DEMO-file.md', fileText) };
      case 'remote.artifacts.list': return { ...envelope, max_bytes: 1048576, truncated: false, rows: blank ? [] : [{ id: 'DEMO-artifact', name: 'DEMO 正式成果物.md', mime: 'text/markdown', bytes: Buffer.byteLength(artifactText), etag: sha(artifactText), producer: 'write_file', registered_at: timestamp }] };
      case 'remote.artifacts.read': return { ...envelope, artifact_id: params.artifact_id, content: content('DEMO-artifact.md', artifactText) };
      case 'remote.notifications.status': return { available: false, reason: 'DEMO この隔離検修は実Push同意を要求しません', public_key: null, subscriptions: [], scope: 'authenticated_owner_profile_session', ttl_seconds: 2592000, max_subscriptions: 8 };
      case 'remote.notifications.unsubscribe_all': return { version: 1, removed: 0 };
      case 'remote.project.create_session': {
        if (params.project_id !== 'DEMO-plan') throw new Error('project_rejected');
        const item = fixture.state.sessions.get(profile); item.durable = `DEMO-project-created-${++revision}`;
        return { session_id: item.live, stored_session_id: item.durable, profile, project: { id: 'DEMO-plan', name: 'DEMO 計画', cwd: '/DEMO/private/project' } };
      }
      default: throw new Error('unsupported');
    }
  }
  await context.routeWebSocket('**', route => {
    const url = new URL(route.url());
    if (url.origin !== fixture.origin.replace('https:', 'wss:') || url.pathname !== '/api/ws') { witness.outsideSockets++; route.close({ code: 1008, reason: 'DEMO outside fixture' }); return; }
    const server = route.connectToServer(), capabilities = new Set();
    server.onMessage(message => {
      for (const line of String(message).split('\n').filter(Boolean)) {
        const frame = JSON.parse(line); const key = `${typeof frame.id}:${frame.id}`;
        if (capabilities.delete(key) && frame.result) { frame.result.generation_allowed = witness.generationAllowed; frame.result.generation_reason = witness.generationAllowed ? '' : 'DEMO この検修は実生成が未許可です。端末内の編集・閲覧だけが利用できます。'; route.send(JSON.stringify(frame)); }
        else route.send(line);
      }
    });
    route.onMessage(message => {
      for (const line of String(message).split('\n').filter(Boolean)) {
        const frame = JSON.parse(line), method = frame.method;
        if (method === 'remote.app.capabilities') capabilities.add(`${typeof frame.id}:${frame.id}`);
        if (!INTERACTION_METHODS.includes(method)) { server.send(line); continue; }
        witness.methods.push(method); const write = ['remote.session.organize', 'remote.session.branch_from_row', 'remote.templates.put', 'remote.templates.remove', 'remote.session.model_set', 'remote.project.create_session'].includes(method);
        if (write) witness.writes.push(method);
        const respond = () => {
          try { if (errors.has(method)) throw new Error('DEMO synthetic refusal'); const result = reply(method, frame.params || {}); route.send(JSON.stringify({ jsonrpc: '2.0', id: frame.id, result })); }
          catch { witness.rejected++; route.send(JSON.stringify({ jsonrpc: '2.0', id: frame.id, error: { code: -32000, message: 'DEMO synthetic contract refusal' } })); }
        };
        if (held.has(method)) { const list = pending.get(method) || []; list.push(respond); pending.set(method, list); }
        else if (delays.has(method)) setTimeout(respond, delays.get(method)); else respond();
      }
    });
  });
  return witness;
}

export async function installSyntheticDeviceSpeech(context) {
  await context.addInitScript(() => {
    const counts = { recognitionStarts: 0, recognitionStops: 0, recognitionAborts: 0, speechStarts: 0, speechCancels: 0 };
    Object.defineProperty(window, '__DEMO_device_counts', { value: counts });
    class Recognition {
      start() { counts.recognitionStarts++; queueMicrotask(() => this.onresult?.({ resultIndex: 0, results: { length: 1, 0: { isFinal: true, 0: { transcript: 'DEMO 合成音声の文章' } } } })); }
      stop() { counts.recognitionStops++; queueMicrotask(() => this.onend?.()); }
      abort() { counts.recognitionAborts++; }
    }
    class Utterance { constructor(text) { this.text = text; } }
    Object.defineProperty(window, 'SpeechRecognition', { configurable: true, value: Recognition });
    Object.defineProperty(window, 'webkitSpeechRecognition', { configurable: true, value: undefined });
    Object.defineProperty(window, 'SpeechSynthesisUtterance', { configurable: true, value: Utterance });
    Object.defineProperty(window, 'speechSynthesis', { configurable: true, value: { speak() { counts.speechStarts++; }, cancel() { counts.speechCancels++; } } });
  });
}
