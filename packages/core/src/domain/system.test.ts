import { describe, expect, it, vi, afterEach } from 'vitest';
import { toCheckpoint, toSystemStats } from './system';

afterEach(() => {
  vi.useRealTimers();
});

describe('toSystemStats', () => {
  it('maps nested backend host/process memory and disk stats', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(1_781_728_435_000));

    const stats = toSystemStats({
      hermes_version: '0.16.0',
      cpu_percent: 15,
      uptime_seconds: 8_648_705,
      memory: {
        total: 16 * 1024 * 1024 * 1024,
        used: 4 * 1024 * 1024 * 1024,
        percent: 25,
      },
      disk: {
        total: 100 * 1024 * 1024 * 1024,
        used: 61 * 1024 * 1024 * 1024,
        free: 39 * 1024 * 1024 * 1024,
        percent: 61,
      },
      process: {
        pid: 2616549,
        create_time: 1_781_724_835,
      },
    });

    expect(stats.version).toBe('0.16.0');
    expect(stats.pid).toBe(2616549);
    expect(stats.uptimeSeconds).toBe(3600);
    expect(stats.hostUptimeSeconds).toBe(8_648_705);
    expect(stats.cpuPercent).toBe(15);
    expect(stats.memoryUsedMb).toBe(4096);
    expect(stats.memoryTotalMb).toBe(16384);
    expect(stats.memoryPercent).toBe(25);
    expect(stats.diskUsedMb).toBe(61 * 1024);
    expect(stats.diskTotalMb).toBe(100 * 1024);
    expect(stats.diskFreeMb).toBe(39 * 1024);
    expect(stats.diskPercent).toBe(61);
  });

  it('maps backup/checkpoint byte sizes to MB', () => {
    const entry = toCheckpoint({
      id: 'backup-1',
      name: 'hermes-pwa-state.tgz',
      created_at: 1_781_724_835,
      bytes: 32 * 1024 * 1024,
      kind: 'archive',
    });

    expect(entry.id).toBe('backup-1');
    expect(entry.name).toBe('hermes-pwa-state.tgz');
    expect(entry.createdAt).toBe(1_781_724_835);
    expect(entry.sizeMb).toBe(32);
    expect(entry.kind).toBe('archive');
  });
});
