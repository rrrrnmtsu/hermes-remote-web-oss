import { describe, expect, it } from 'vitest';
import { RemoteController } from '../../../core/src/stores/remote';
import type { Http } from '../../../core/src/transport/http';
import { filterNavigationCommands, isNavigationShortcut, navigationCommands } from './quick-navigation';

function snapshot() {
  const http: Http = Object.assign(async <T,>() => ({} as T), { setProfile: () => undefined });
  return new RemoteController({ http, origin: 'https://demo.invalid', secure: true,
    makeGateway: () => { throw new Error('DEMO model only'); }, withOperationLock: async action => action() }).store.getState();
}

describe('bounded navigation destinations', () => {
  it('contains existing navigation/read panels only and scopes pending counts to the current conversation', () => {
    const commands = navigationCommands({ ...snapshot(), connection: 'connected', profile: 'DEMO', liveId: 'DEMO-live',
      requests: [
        { id: 1, key: 'number:1', profile: 'DEMO', sessionId: 'DEMO-live', method: 'approval', params: {}, status: 'pending' },
        { id: 2, key: 'number:2', profile: 'other', sessionId: 'DEMO-live', method: 'approval', params: {}, status: 'pending' },
        { id: 3, key: 'number:3', profile: 'DEMO', sessionId: 'other', method: 'clarify', params: {}, status: 'pending' },
      ] });
    expect(commands.map(command => command.id)).toEqual(['current', 'conversations', 'sessions', 'requests', 'settings', 'templates', 'info', 'artifacts', 'files']);
    expect(commands.find(command => command.id === 'requests')?.description).toContain('未回答 1件');
    expect(JSON.stringify(commands)).not.toContain('DEMO-live');
    expect(JSON.stringify(commands)).not.toContain('DEMO');
  });
  it('gates unavailable read panels without using method presence as a generation gate', () => {
    const state = { ...snapshot(), connection: 'connected' as const, featureMethods: ['remote.files.roots', 'remote.info.models'] };
    const commands = navigationCommands(state);
    expect(commands.find(command => command.id === 'files')?.disabledReason).toBeUndefined();
    expect(commands.find(command => command.id === 'info')?.disabledReason).toBeUndefined();
    expect(commands.find(command => command.id === 'artifacts')?.disabledReason).toContain('会話を先に');
    expect(commands.find(command => command.id === 'templates')?.disabledReason).toContain('未対応');
    expect(navigationCommands({ ...state, connection: 'offline' }).find(command => command.id === 'files')?.disabledReason).toContain('接続後');
    expect(navigationCommands({ ...state, connection: 'offline' }).find(command => command.id === 'settings')?.disabledReason).toBeUndefined();
  });
  it('matches Japanese, normalized English and multiple literal words without searching conversation data', () => {
    const commands = navigationCommands(snapshot());
    expect(filterNavigationCommands(commands, 'ＳＥＴＴＩＮＧＳ font').map(command => command.id)).toEqual(['settings']);
    expect(filterNavigationCommands(commands, '成果物').map(command => command.id)).toEqual(['artifacts']);
    expect(filterNavigationCommands(commands, '[.*]').map(command => command.id)).toEqual([]);
    expect(filterNavigationCommands(commands, '🤷').map(command => command.id)).toEqual([]);
    expect(filterNavigationCommands(commands, '')).toHaveLength(commands.length);
    expect(filterNavigationCommands(commands, 'a'.repeat(1_000_000))).toEqual([]);
  });
  it('accepts one explicit desktop shortcut, respecting IME, modifiers, repeat and prior event ownership', () => {
    const ctrl = new KeyboardEvent('keydown', { key: 'k', ctrlKey: true, cancelable: true });
    expect(isNavigationShortcut(ctrl, false)).toBe(true);
    expect(isNavigationShortcut(new KeyboardEvent('keydown', { key: 'K', metaKey: true }), false)).toBe(true);
    expect(isNavigationShortcut(ctrl, true)).toBe(false);
    for (const options of [{ key: 'k' }, { key: 'k', ctrlKey: true, metaKey: true }, { key: 'k', ctrlKey: true, shiftKey: true },
      { key: 'k', ctrlKey: true, altKey: true }, { key: 'k', ctrlKey: true, repeat: true }, { key: 'k', ctrlKey: true, isComposing: true },
      { key: 'k', ctrlKey: true, keyCode: 229 }]) expect(isNavigationShortcut(new KeyboardEvent('keydown', options), false)).toBe(false);
    ctrl.preventDefault(); expect(isNavigationShortcut(ctrl, false)).toBe(false);
  });
});
