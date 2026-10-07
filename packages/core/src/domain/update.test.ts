import { describe, expect, it } from 'vitest';
import { toUpdateCheck } from './update';

describe('toUpdateCheck', () => {
  it('converts backend snake_case update status into frontend shape', () => {
    const update = toUpdateCheck({
      ok: true,
      current: '0.1.0',
      latest: '0.1.1',
      source: 'npm',
      update_available: true,
      can_apply: false,
      manual_required: true,
      install_method: 'npm',
      checked_at: '2026-06-25T15:49:51Z',
      instructions: [
        {
          id: 'npx-force-reinstall',
          label: 'npm / npx',
          command: 'npx -y hermes-pwa@latest install --force',
          steps: ['Run command'],
        },
      ],
    });

    expect(update).toMatchObject({
      ok: true,
      current: '0.1.0',
      latest: '0.1.1',
      source: 'npm',
      updateAvailable: true,
      canApply: false,
      manualRequired: true,
      installMethod: 'npm',
      checkedAt: '2026-06-25T15:49:51Z',
    });
    expect(update.instructions[0]).toEqual({
      id: 'npx-force-reinstall',
      label: 'npm / npx',
      command: 'npx -y hermes-pwa@latest install --force',
      steps: ['Run command'],
    });
  });

  it('defaults missing optional fields safely', () => {
    const update = toUpdateCheck({ current: '0.1.0' });

    expect(update.ok).toBe(true);
    expect(update.latest).toBeNull();
    expect(update.updateAvailable).toBe(false);
    expect(update.instructions).toEqual([]);
  });

  it('preserves quiet failure details without claiming an update', () => {
    const update = toUpdateCheck({
      ok: false,
      current: '0.1.0',
      latest: null,
      update_available: false,
      error: 'check-failed',
      message: 'Unable to check npm latest version right now.',
    });

    expect(update.ok).toBe(false);
    expect(update.error).toBe('check-failed');
    expect(update.message).toContain('Unable');
    expect(update.updateAvailable).toBe(false);
  });
});
