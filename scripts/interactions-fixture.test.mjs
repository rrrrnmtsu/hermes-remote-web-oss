import assert from 'node:assert/strict';
import test from 'node:test';
import { installInteractionFixture } from './interactions-fixture.mjs';

async function harness() {
  const fixture = { origin: 'https://127.0.0.1:12345', state: { sessions: new Map(), featureMethods: [] } };
  let handler, incoming; const output = [];
  const context = { async routeWebSocket(_pattern, apply) { handler = apply; } };
  const witness = await installInteractionFixture(context, fixture);
  handler({ url: () => 'wss://127.0.0.1:12345/api/ws', connectToServer() { return { onMessage() {}, send() {} }; }, onMessage(callback) { incoming = callback; }, send(message) { output.push(JSON.parse(message)); }, close() { throw new Error('Unexpected close'); } });
  let id = 0;
  const call = (method, params = {}) => { incoming(JSON.stringify({ jsonrpc: '2.0', id: ++id, method, params: { profile: 'default', ...params } })); return output.at(-1); };
  return { witness, fixture, call, output };
}
test('synthetic UI adapter refuses another profile and exposes no credentials', async () => {
  const { call, witness } = await harness(); assert.ok(call('remote.info.models', { profile: 'unowned' }).error); assert.equal(witness.rejected, 1);
});
test('explicit list query, empty and keyset next page affect returned rows', async () => {
  const { call, witness } = await harness(); assert.equal(call('remote.sessions.list').result.next_cursor, 'DEMO-page-2');
  assert.equal(call('remote.sessions.list', { query: 'not-matching' }).result.sessions.length, 0);
  assert.equal(call('remote.sessions.list', { cursor: 'DEMO-page-2' }).result.next_cursor, null);
  witness.empty('remote.sessions.list'); assert.equal(call('remote.sessions.list').result.sessions.length, 0);
});
test('model change checks revision and known limits then returns configured route', async () => {
  const { call } = await harness(); const before = call('remote.info.models', { session_id: 'DEMO-live-default' }).result;
  assert.ok(call('remote.session.model_set', { model: 'DEMO-alternate', expected_revision: 'stale' }).error);
  const after = call('remote.session.model_set', { model: 'DEMO-alternate', expected_revision: before.revision, session_id: 'DEMO-live-default' }).result;
  assert.equal(after.model, 'DEMO-alternate'); assert.equal(after.session_id, 'DEMO-live-default'); assert.notEqual(after.revision, before.revision);
});
test('organization version checks and mutable readback stay inside own session', async () => {
  const { call } = await harness(); const before = call('remote.session.metadata', { session_id: 'DEMO-durable-default' }).result.session;
  const after = call('remote.session.organize', { session_id: before.session_id, expected_version: before.version, pinned: true }).result.session;
  assert.equal(after.pinned, true); assert.notEqual(after.version, before.version);
  assert.ok(call('remote.session.organize', { expected_version: before.version, pinned: false }).error);
});
test('template create/update/remove enforce version readback', async () => {
  const { call } = await harness(); const item = call('remote.templates.put', { name: 'DEMO new', category: 'DEMO', body: 'DEMO only' }).result.template;
  assert.equal(item.version, 1); const edited = call('remote.templates.put', { id: item.id, expected_version: item.version, name: 'DEMO new', category: 'DEMO', body: 'DEMO edited' }).result.template;
  assert.equal(edited.version, 2); assert.ok(call('remote.templates.remove', { id: item.id, expected_version: 1 }).error);
  assert.equal(call('remote.templates.remove', { id: item.id, expected_version: 2 }).result.removed, item.id);
});
test('held read gives no ACK until explicit single release, errors remain errors', async () => {
  const { call, witness, output } = await harness(); witness.hold('remote.info.models'); call('remote.info.models'); assert.equal(output.length, 0);
  witness.release('remote.info.models'); assert.equal(output.length, 1); witness.release('remote.info.models'); assert.equal(output.length, 1);
  witness.fail('remote.info.models'); assert.ok(call('remote.info.models').error);
});
test('file and artifact bytes/hash differ while metadata sizes match', async () => {
  const { call } = await harness(); const file = call('remote.files.read', { root_id: 'DEMO-root', path: 'DEMO-file.md' }).result.content;
  const artifact = call('remote.artifacts.read', { artifact_id: 'DEMO-artifact' }).result.content;
  assert.notEqual(file.sha256, artifact.sha256); assert.equal(file.bytes, Buffer.byteLength(file.text)); assert.equal(artifact.bytes, Buffer.byteLength(artifact.text));
});
