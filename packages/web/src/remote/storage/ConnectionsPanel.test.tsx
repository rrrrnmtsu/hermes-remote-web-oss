import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { ConnectionsPanel } from './ConnectionsPanel';
import { BrowserConnections, type SavedConnection } from './connections';

beforeAll(() => {
  Object.defineProperty(HTMLDialogElement.prototype, 'showModal', { configurable: true, value: function(this: HTMLDialogElement) { this.setAttribute('open', ''); } });
  Object.defineProperty(HTMLDialogElement.prototype, 'close', { configurable: true, value: function(this: HTMLDialogElement) { this.removeAttribute('open'); } });
});
afterEach(cleanup);

describe('cookie-boundary navigation controls', () => {
  it('does not save or contact a same-host alternate-port destination selected in the form', async () => {
    const write = vi.fn(); const before = vi.fn(); const request = vi.spyOn(globalThis, 'fetch');
    const connections = new BrowserConnections({ read: async () => [], write }, () => 'https://demo.example:9443');
    render(<ConnectionsPanel connections={connections} currentOrigin="https://demo.example:9443" canNavigate onBeforeNavigate={before} />);
    fireEvent.change(screen.getByLabelText('HTTPS接続先'), { target: { value: 'https://demo.example:9444' } });
    fireEvent.click(screen.getByRole('checkbox', { name: '自分が利用を許可された接続先です' }));
    fireEvent.click(screen.getByRole('button', { name: '接続先を登録' }));
    await screen.findByRole('status'); expect(screen.getByRole('status')).toHaveTextContent('同じホストの別ポート');
    expect(write).not.toHaveBeenCalled(); expect(before).not.toHaveBeenCalled(); expect(request).not.toHaveBeenCalled(); request.mockRestore();
  });
  it('hides forbidden persisted entries while keeping unrelated HTTPS entries available', async () => {
    const entries: SavedConnection[] = [{ origin: 'https://demo.example:9444', label: 'DEMO forbidden' }, { origin: 'https://other.example:9443', label: 'DEMO permitted' }];
    const write = vi.fn(); const connections = new BrowserConnections({ read: async () => entries, write }, () => 'https://demo.example:9443');
    render(<ConnectionsPanel connections={connections} currentOrigin="https://demo.example:9443" canNavigate />);
    await screen.findByText('DEMO permitted'); expect(screen.queryByText('DEMO forbidden')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '別接続先を開く' })).toBeEnabled(); expect(write).not.toHaveBeenCalled();
  });
  it('rejects a stale confirmation before locking a draft or invoking navigation', async () => {
    let origin = 'https://original.example:9443'; const destination = { origin: 'https://other.example:9444', label: 'DEMO selected earlier' };
    const connections = new BrowserConnections({ read: async () => [destination], write: vi.fn() }, () => origin);
    const open = vi.spyOn(connections, 'open').mockImplementation(() => undefined); const before = vi.fn();
    render(<ConnectionsPanel connections={connections} currentOrigin={origin} canNavigate onBeforeNavigate={before} />);
    fireEvent.click(await screen.findByRole('button', { name: '別接続先を開く' }));
    const dialog = await screen.findByRole('dialog', { name: '別接続先へ移動' });
    origin = 'https://other.example:9443';
    fireEvent.click(within(dialog).getByRole('button', { name: '接続先を開く' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(screen.getByRole('status')).toHaveTextContent('同じホストの別ポート'); expect(before).not.toHaveBeenCalled(); expect(open).not.toHaveBeenCalled();
  });
});
