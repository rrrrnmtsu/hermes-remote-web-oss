import { describe, expect, it, vi } from 'vitest';
import { BotOverviewController, botSessions, projectBotStatus, type BotScope } from './bots';

const scope: BotScope = { origin: 'https://demo.invalid', principal: 'DEMO-owner', profile: 'DEMO-profile', generation: '1' };
const status = () => ({ gateway_running: true, gateway_state: 'running', gateway_platforms: {
  discord: { state: 'connected', connected: true, updated_at: '2026-10-07T00:00:00Z' },
  telegram: { state: 'disconnected', connected: false },
}, gateway_updated_at: '2026-10-07T00:00:00Z' });
function deferred<T>() { let resolve!: (value: T) => void; let reject!: (value: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }

describe('existing messaging bot status projection', () => {
  it('projects runtime evidence without treating configured/enabled as connected or keeping secret/error/path metadata', () => {
    const value = { ...status(), env_path: '/DEMO/private', install_id: 'DEMO-install', token: 'DEMO-secret',
      gateway_exit_reason: 'DEMO-secret error', gateway_platforms: {
        discord: { state: 'connected', connected: true, error_message: 'DEMO-secret error', writer_pid: 123 },
        telegram: { configured: true, enabled: true, env_vars: [{ redacted_value: 'DEMO-secret' }] },
      } };
    const snapshot = projectBotStatus(value, scope.profile, 5)!;
    expect(snapshot.platforms.map(row => row.state)).toEqual(['connected', 'unknown']);
    expect(snapshot.observedAt).toBe(5);
    expect(JSON.stringify(snapshot)).not.toMatch(/DEMO-secret|private|env_vars|install_id|error_message|writer_pid/);
  });
  it('keeps unsupported schemas distinct from malformed status and unknown platform fields', () => {
    expect(projectBotStatus(null, 'DEMO')).toBeNull();
    expect(projectBotStatus({ version: 'old' }, 'DEMO')).toBeNull();
    expect(() => projectBotStatus({ gateway_running: 'yes' }, 'DEMO')).toThrow();
    expect(() => projectBotStatus({ gateway_running: true, gateway_platforms: [] }, 'DEMO')).toThrow();
    const older = projectBotStatus({ gateway_running: true }, 'DEMO')!;
    expect(older.gatewayState).toBe('unknown'); expect(older.platformsAvailable).toBe(false);
  });
  it('never reports retained connected state as a running gateway after stop or contradictory evidence', () => {
    expect(projectBotStatus({ ...status(), gateway_running: false, gateway_state: 'stopped' }, 'DEMO')!.platforms[0]?.state).toBe('gateway_stopped');
    const inconsistent = projectBotStatus({ ...status(), gateway_running: false }, 'DEMO')!;
    expect(inconsistent.gatewayState).toBe('unknown'); expect(inconsistent.platforms[0]?.state).toBe('unknown');
    expect(projectBotStatus({ ...status(), gateway_platforms: { discord: { state: 'connected', connected: false } } }, 'DEMO')!.platforms[0]?.state).toBe('unknown');
  });
  it('uses only the selected-profile namespace, avoids duplicates and bounds platform rows', () => {
    const value = { ...status(), gateway_platforms: { 'other:discord': { state: 'connected' },
      'DEMO-profile:telegram': { state: 'connected' }, telegram: { state: 'connected' },
      '<script>': { state: 'connected' }, broken: null, 'extra:part:discord': { state: 'connected' } } };
    const snapshot = projectBotStatus(value, scope.profile)!;
    expect(snapshot.platforms.map(row => row.id)).toEqual(['telegram']); expect(snapshot.truncated).toBe(true);
    expect(projectBotStatus({ ...status(), gateway_platforms: Object.fromEntries(Array.from({ length: 80 }, (_, i) => ['plugin'+i, { state: 'connected' }])) }, scope.profile)!.platforms).toHaveLength(50);
  });
  it('normalizes valid timestamps and does not mistake missing heartbeat or sharing evidence for fresh/exclusive proof', () => {
    const snapshot = projectBotStatus({ ...status(), gateway_updated_at: 'broken', gateway_heartbeat_stale_s: 100, gateway_shared_with: ['a', 'b'] }, scope.profile)!;
    expect(snapshot.updatedAt).toBeNull(); expect(snapshot.heartbeatStaleSeconds).toBe(100); expect(snapshot.sharedGateway).toBe(true);
    expect(projectBotStatus({ ...status(), gateway_heartbeat_stale_s: Infinity }, scope.profile)!.heartbeatStaleSeconds).toBeNull();
    expect(projectBotStatus(status(), scope.profile)!.sharedGateway).toBeNull();
    expect(projectBotStatus({ ...status(), gateway_shared_with: ['a'] }, scope.profile)!.sharedGateway).toBe(false);
  });
  it('does not use Object prototype properties as display names for an untrusted custom platform', () => {
    const snapshot = projectBotStatus({ ...status(), gateway_platforms: { constructor: { state: 'connected' } } }, scope.profile)!;
    expect(snapshot.platforms).toEqual([{ id: 'constructor', name: 'その他のボット', state: 'connected', updatedAt: null }]);
    expect(JSON.stringify(snapshot)).toContain('その他のボット');
  });
  it('filters only already loaded platform-labelled conversations with a bounded result', () => {
    const platforms = projectBotStatus(status(), scope.profile)!.platforms;
    const rows = [{ source: 'tui', id: 'local' }, { source: 'Discord', id: 'discord' }, { source: 'telegram', id: 'telegram' }, { source: 'gateway', id: 'unknown' }];
    expect(botSessions(rows, platforms).map(row => row.id)).toEqual(['discord', 'telegram']);
    expect(botSessions(Array.from({ length: 80 }, () => ({ source: 'discord' })), platforms)).toHaveLength(50);
  });
});

describe('memory-only bot overview reads', () => {
  it('makes no request until explicit load and suppresses double activation without polling', async () => {
    const pending = deferred<unknown>(), readStatus = vi.fn<(profile: string, signal: AbortSignal) => Promise<unknown>>(() => pending.promise);
    const controller = new BotOverviewController({ readStatus }); controller.setScope(scope);
    expect(readStatus).not.toHaveBeenCalled();
    const first = controller.load(); await controller.load(); expect(readStatus).toHaveBeenCalledTimes(1);
    expect(readStatus.mock.calls[0]?.[0]).toBe(scope.profile);
    pending.resolve(status()); await first;
    expect(controller.store.getState().load).toBe('ready'); expect(readStatus).toHaveBeenCalledTimes(1);
  });
  it.each(['profile', 'principal', 'origin', 'generation'] as const)('aborts and ignores a late reply after %s changes', async key => {
    const pending = deferred<unknown>(), readStatus = vi.fn<(profile: string, signal: AbortSignal) => Promise<unknown>>(() => pending.promise);
    const controller = new BotOverviewController({ readStatus }); controller.setScope(scope);
    const action = controller.load(); const signal = readStatus.mock.calls[0]?.[1] as AbortSignal;
    controller.setScope({ ...scope, [key]: 'DEMO-new' });
    expect(signal.aborted).toBe(true); pending.resolve(status()); await action;
    expect(controller.store.getState().snapshot).toBeNull(); expect(controller.store.getState().load).toBe('idle');
  });
  it('closing/logging out aborts a read and prevents a late error from crossing into a reopened panel', async () => {
    const first = deferred<unknown>(), readStatus = vi.fn().mockReturnValueOnce(first.promise).mockResolvedValue(status());
    const controller = new BotOverviewController({ readStatus }); controller.setScope(scope);
    const old = controller.load(); controller.cancel(); await controller.load(); first.reject(new Error('DEMO-secret')); await old;
    expect(controller.store.getState().load).toBe('ready'); expect(controller.store.getState().error).toBe('');
    controller.setScope(null); await controller.load(); expect(readStatus).toHaveBeenCalledTimes(2);
    expect(controller.store.getState().snapshot).toBeNull();
  });
  it('retains the previous read as stale on failure, sanitizes raw errors and retries only on another explicit load', async () => {
    const readStatus = vi.fn().mockResolvedValueOnce(status()).mockRejectedValueOnce(new Error('DEMO-secret')).mockResolvedValue(status());
    const controller = new BotOverviewController({ readStatus }); controller.setScope(scope);
    await controller.load(); const snapshot = controller.store.getState().snapshot; await controller.load();
    expect(controller.store.getState().load).toBe('error'); expect(controller.store.getState().snapshot).toBe(snapshot);
    expect(controller.store.getState().error).not.toContain('DEMO-secret'); expect(readStatus).toHaveBeenCalledTimes(2);
    await controller.load(); expect(controller.store.getState().load).toBe('ready'); expect(readStatus).toHaveBeenCalledTimes(3);
  });
  it('does not silently fall back or call another method when the server schema is unsupported', async () => {
    const readStatus = vi.fn().mockResolvedValue({ version: 'old' });
    const controller = new BotOverviewController({ readStatus }); controller.setScope(scope); await controller.load();
    expect(controller.store.getState().load).toBe('unsupported'); expect(readStatus).toHaveBeenCalledTimes(1);
    controller.setScope({ ...scope }); expect(controller.store.getState().load).toBe('unsupported');
  });
});
