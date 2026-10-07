import test from 'node:test';
import assert from 'node:assert/strict';
import { geometryFailures } from './layout-geometry.mjs';

const control = label => ({ label, tag: 'BUTTON', visible: true, fullyInViewport: true,
  unclipped: true, hit: true, disabled: false, rect: { width: 48, height: 48 } });
const target = (label, matchCount) => ({ label, selector: `.DEMO-${label}`, matchCount });
const geometry = (targets, controls) => ({ overflowX: 0, targets, controls });

test('a visible composer does not conceal a missing send selector', () => {
  const errors = geometryFailures(geometry([target('composer', 1), target('send', 0)], [control('composer:0')]));
  assert.deepEqual(errors.map(({ rule, label }) => ({ rule, label })), [{ rule: 'required_selector_missing', label: 'send' }]);
});

test('a visible send button does not conceal a missing close selector', () => {
  const errors = geometryFailures(geometry([target('send', 1), target('close', 0)], [control('send:0')]));
  assert.equal(errors.length, 1); assert.equal(errors[0].label, 'close');
});

test('every missing required selector is reported', () => {
  const errors = geometryFailures(geometry([target('send', 0), target('cancel', 0)], []));
  assert.deepEqual(errors.filter(error => error.rule === 'required_selector_missing').map(error => error.label), ['send', 'cancel']);
  assert.ok(errors.some(error => error.rule === 'required_control_missing'));
});

test('an intentionally multiple action selector remains supported', () => {
  assert.deepEqual(geometryFailures(geometry([target('actions', 2)], [control('actions:0'), control('actions:1')])), []);
});

test('optional absent selectors are allowed only with required false', () => {
  const actual = geometry([target('optional', 0)], []);
  assert.ok(geometryFailures(actual).length > 0);
  assert.deepEqual(geometryFailures(actual, { required: false }), []);
});

test('malformed match counts cannot imply required selector presence', () => {
  for (const count of [-1, undefined, NaN, 0.5, '1']) {
    const errors = geometryFailures(geometry([target('send', count)], [control('send:0')]));
    assert.ok(errors.some(error => error.rule === 'required_selector_missing'));
  }
});

test('selector presence preserves clipping, hit, touch and input checks', () => {
  const actual = geometry([target('input', 1)], [{ ...control('input:0'), tag: 'TEXTAREA', fontSize: 15,
    fullyInViewport: false, unclipped: false, hit: false, rect: { width: 43, height: 32 } }]);
  assert.deepEqual(geometryFailures(actual, { input: true }).map(error => error.rule),
    ['control_outside_visual_viewport', 'control_clipped', 'control_covered', 'touch_target', 'input_below_16px']);
});

test('legacy immutable geometry still detects an empty control set', () => {
  assert.deepEqual(geometryFailures({ overflowX: 0, controls: [] }), [{ rule: 'required_control_missing' }]);
});
