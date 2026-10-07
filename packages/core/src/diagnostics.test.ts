import { describe, it, expect } from 'vitest';
import { explainConnectionError, connectionStateLabel } from './diagnostics';

describe('explainConnectionError', () => {
  it('maps network fetch errors to check-network advice', () => {
    const result = explainConnectionError(new Error('Failed to fetch'));
    expect(result.advice).toBe('check-network');
    expect(result.message).toMatch(/Dashboard/);
  });

  it('maps HTTP 401 to sign-in-again advice', () => {
    const result = explainConnectionError({ status: 401 });
    expect(result.advice).toBe('sign-in-again');
  });

  it('maps HTTP 403 to sign-in-again advice', () => {
    const result = explainConnectionError({ status: 403 });
    expect(result.advice).toBe('sign-in-again');
  });

  it('maps ticket/websocket errors to retrying advice', () => {
    const result = explainConnectionError(new Error('ws ticket failed'));
    expect(result.advice).toBe('retrying');
    expect(result.message).toMatch(/Live updates/);
  });

  it('falls back to the raw message', () => {
    const result = explainConnectionError(new Error('Something weird'));
    expect(result.message).toBe('Something weird');
    expect(result.advice).toBe('retrying');
  });
});

describe('connectionStateLabel', () => {
  it('returns user-friendly labels', () => {
    expect(connectionStateLabel('connected')).toBe('Connected');
    expect(connectionStateLabel('reconnecting')).toBe('Reconnecting…');
    expect(connectionStateLabel('offline')).toBe('Offline');
    expect(connectionStateLabel('unknown')).toBe('unknown');
  });
});
