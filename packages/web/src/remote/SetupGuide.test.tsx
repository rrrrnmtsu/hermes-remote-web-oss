import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { RemoteController } from '../../../core/src/stores/remote';
import type { Http } from '../../../core/src/transport/http';
import { SetupGuide } from './SetupGuide';

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
function controller() {
  const reads = vi.fn();
  const http: Http = Object.assign(async <T,>() => { reads(); return {} as T; }, { setProfile: () => undefined });
  const c = new RemoteController({ http, origin: 'https://demo.invalid', secure: true,
    makeGateway: () => { throw new Error('never_connect'); }, withOperationLock: async action => action() });
  c.store.setState({ draft: 'DEMO-keep-draft', profile: 'DEMO-keep-profile', diagnostic: 'DEMO-private-error' });
  return { c, http: reads };
}
describe('setup guidance and explicit diagnostic copy', () => {
  it('does not call network, send or storage when rendering and opening diagnostics', () => {
    const { c, http } = controller(); const submit = vi.spyOn(c, 'submit');
    const storage = vi.spyOn(Storage.prototype, 'setItem');
    render(<SetupGuide state={c.store.getState()} buildId="remote-v2-0123456789abcdef" />);
    fireEvent.click(screen.getByText('共有する診断の項目を確認'));
    expect(screen.getByLabelText('サニタイズ診断テキスト')).not.toHaveTextContent('DEMO-');
    expect(http).not.toHaveBeenCalled(); expect(submit).not.toHaveBeenCalled(); expect(storage).not.toHaveBeenCalled();
    expect(c.store.getState().draft).toBe('DEMO-keep-draft'); storage.mockRestore();
  });
  it('copies once on explicit action and retains unknown copy results until resolved', async () => {
    const { c } = controller(); let complete!: () => void;
    const writeText = vi.fn((text: string) => { expect(text).toBeTruthy(); return new Promise<void>(resolve => { complete = resolve; }); });
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
    render(<SetupGuide state={c.store.getState()} buildId="remote-v2-0123456789abcdef" />);
    fireEvent.click(screen.getByText('共有する診断の項目を確認'));
    const button = screen.getByRole('button', { name: 'サニタイズ診断をコピー' });
    fireEvent.click(button); fireEvent.click(button);
    expect(writeText).toHaveBeenCalledTimes(1); expect(button).toBeDisabled();
    expect(screen.queryByText(/コピーしました/)).toBeNull();
    expect(writeText.mock.calls[0]?.[0]).not.toContain('DEMO-');
    complete(); await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('コピーしました'));
    expect(c.store.getState().draft).toBe('DEMO-keep-draft');
  });
  it('provides manual selection when the browser refuses clipboard, without claiming success', async () => {
    const { c } = controller();
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: vi.fn().mockRejectedValue(new Error('DEMO-private-browser-error')) } });
    render(<SetupGuide state={c.store.getState()} buildId="remote-v2-0123456789abcdef" />);
    fireEvent.click(screen.getByText('共有する診断の項目を確認')); fireEvent.click(screen.getByRole('button', { name: 'サニタイズ診断をコピー' }));
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('コピーを確認できません'));
    expect(screen.queryByText('DEMO-private-browser-error')).toBeNull();
  });
});
