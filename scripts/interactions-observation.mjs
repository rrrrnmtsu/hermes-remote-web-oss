/** Read-only UI witness guards. Missing or merely selected states are not ACKs. */
export function sameVisibleReturnFocus(expected, actual) {
  return Boolean(expected && actual && expected.connected === true && actual.connected === true
    && expected.visible === true && actual.visible === true && expected.tag !== 'BODY' && expected.tag !== 'HTML'
    && expected.tag === actual.tag && (expected.id || '') === (actual.id || '')
    && (expected.label || '') === (actual.label || '') && !actual.dialog);
}
export function profileReadReady(expected, observed) {
  return typeof expected === 'string' && observed?.profile === expected && observed.connection === 'connected'
    && observed.listRendered === true && observed.listLoading === false;
}
