import assert from 'node:assert/strict';
import test from 'node:test';
import { sameVisibleReturnFocus, profileReadReady } from './interactions-observation.mjs';
const button = { tag: 'BUTTON', label: '会話メニュー', id: '', connected: true, visible: true, dialog: null };
test('helper keeps actual prelaunch focus when pointerdown deliberately preserves it', () => {
  assert.equal(sameVisibleReturnFocus(button, { ...button }), true);
  assert.equal(sameVisibleReturnFocus(button, { ...button, label: '入力の補助' }), false);
  const input = { ...button, tag: 'TEXTAREA', id: 'remote-input', label: '' };
  assert.equal(sameVisibleReturnFocus(input, { ...input }), true);
});
test('body, hidden, detached, another modal and missing focus cannot satisfy return', () => {
  for (const actual of [null, { ...button, tag: 'BODY' }, { ...button, visible: false }, { ...button, connected: false }, { ...button, dialog: '別dialog' }]) assert.equal(sameVisibleReturnFocus(button, actual), false);
  assert.equal(sameVisibleReturnFocus({ ...button, tag: 'BODY' }, { ...button, tag: 'BODY' }), false);
});
test('profile select value alone before connected/list ACK remains false', () => {
  const pending = { profile: 'DEMO-secondary', connection: 'reconnecting', listRendered: false, listLoading: true };
  assert.equal(profileReadReady('DEMO-secondary', pending), false);
  assert.equal(profileReadReady('DEMO-secondary', { ...pending, connection: 'connected' }), false);
});
test('correct profile plus connected and completed visible list passes', () => {
  assert.equal(profileReadReady('DEMO-secondary', { profile: 'DEMO-secondary', connection: 'connected', listRendered: true, listLoading: false }), true);
});
test('stale profile/loading/missing or loosely truthy data never pass', () => {
  const ready = { profile: 'default', connection: 'connected', listRendered: true, listLoading: false };
  assert.equal(profileReadReady('DEMO-secondary', ready), false);
  for (const data of [undefined, { ...ready, listLoading: true }, { ...ready, listRendered: 1 }, { ...ready, connection: 'rpc' }]) assert.equal(profileReadReady('default', data), false);
});
