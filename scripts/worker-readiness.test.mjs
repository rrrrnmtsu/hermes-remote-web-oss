import assert from 'node:assert/strict';
import { test } from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { waitForReadOnlyObservation, waitForOwnedWorkerState } from './worker-readiness.mjs';

test('asynchronously resolved false is observed again before strict true', async () => {
  const results = [false, false, true]; let calls = 0;
  const result = await waitForReadOnlyObservation(async () => { await delay(1); calls++; return results.shift(); }, { timeoutMs: 1000, intervalMs: 1 });
  assert.equal(calls, 3); assert.equal(result.observations, 3);
});

test('truthy values and promises resolving false never imply readiness', async () => {
  let calls = 0;
  await assert.rejects(waitForReadOnlyObservation(async () => { calls++; return calls % 2 ? false : {}; }, { timeoutMs: 30, intervalMs: 1 }), /timed out/);
  assert.ok(calls >= 2);
});

test('a stalled read is bounded and does not start another observation', async () => {
  let calls = 0;
  await assert.rejects(waitForReadOnlyObservation(() => { calls++; return new Promise(() => {}); }, { timeoutMs: 20, intervalMs: 1 }), /timed out/);
  assert.equal(calls, 1);
});

test('a failed read rejects without another observation or write retry', async () => {
  let calls = 0;
  await assert.rejects(waitForReadOnlyObservation(async () => { calls++; throw new Error('DEMO unavailable'); }), /DEMO unavailable/);
  assert.equal(calls, 1);
});

test('owned worker state wait awaits successive evaluate results and never mutates', async () => {
  const seen = []; const results = [false, false, true];
  const page = { async evaluate(predicate, state) { seen.push({ predicate: predicate.toString(), state }); await delay(1); return results.shift(); } };
  const result = await waitForOwnedWorkerState(page, 'waiting', { timeoutMs: 1000, intervalMs: 1 });
  assert.equal(result.observations, 3); assert.ok(seen.every(item => item.state === 'waiting'));
  assert.ok(seen.every(item => item.predicate.includes('item.scope === scope') && item.predicate.includes("state === 'installed'")));
  assert.ok(seen.every(item => !/\.register\(|\.update\(|\.unregister\(|postMessage\(|fetch\(/.test(item.predicate)));
});

test('invalid observation scope and limits fail before browser access', async () => {
  let calls = 0; const page = { evaluate() { calls++; } };
  await assert.rejects(waitForOwnedWorkerState(page, 'activated'), /Invalid worker observation state/);
  await assert.rejects(waitForReadOnlyObservation(() => { calls++; }, { timeoutMs: 0 }), /Invalid observation bound/);
  assert.equal(calls, 0);
});
