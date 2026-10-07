import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { Activity } from './Activity';
import { useActivityStore, useConnectionStore, makeRpcEvents } from '@hermes-pwa/core';

const rpcMock = {
  request: vi.fn(),
  onFrame: vi.fn(),
  events: makeRpcEvents(),
} as unknown as import('@hermes-pwa/core').RpcClient;

describe('Activity', () => {
  beforeEach(() => {
    useActivityStore.setState({ items: [], loading: false, error: undefined });
    useConnectionStore.setState({ state: 'connected', error: undefined } as ReturnType<typeof useConnectionStore.getState>);
    vi.clearAllMocks();
  });

  it('renders empty state when no items', async () => {
    render(<Activity rpc={rpcMock} />);
    await waitFor(() => expect(screen.getByText(/All clear/i)).toBeInTheDocument());
  });

  it('renders pending approval items', () => {
    useActivityStore.setState({
      items: [
        { id: 'a-1', kind: 'approval', status: 'needs_you', title: 'shell.exec', summary: 'git commit', createdAt: 1 },
        { id: 'a-2', kind: 'run', status: 'running', title: 'Running', createdAt: 1 },
      ],
    });
    render(<Activity rpc={rpcMock} />);
    expect(screen.getByText('shell.exec')).toBeInTheDocument();
    expect(screen.getByText('Running')).toBeInTheDocument();
  });

  it('shows connecting state when init/offline', () => {
    useConnectionStore.setState({ state: 'init', error: undefined } as ReturnType<typeof useConnectionStore.getState>);
    render(<Activity rpc={rpcMock} />);
    expect(screen.getByText(/Connecting to Hermes/i)).toBeInTheDocument();
  });

  it('keeps cached content visible while reconnecting', () => {
    useActivityStore.setState({
      items: [{ id: 'a-1', kind: 'approval', status: 'needs_you', title: 'Cached item', createdAt: 1 }],
    });
    useConnectionStore.setState({ state: 'reconnecting', error: undefined } as ReturnType<typeof useConnectionStore.getState>);
    render(<Activity rpc={rpcMock} />);
    expect(screen.getByText('Cached item')).toBeInTheDocument();
  });

  it('does not subscribe to ws events directly; AppShell owns the global activity feed', async () => {
    render(<Activity rpc={rpcMock} />);
    rpcMock.events.dispatchEvent({ type: 'approval.request', payload: { id: 'a-1', title: 'New approval' } });
    await waitFor(() => expect(screen.getByText(/All clear/i)).toBeInTheDocument());
  });

  it('ignores status.update without process text', async () => {
    useActivityStore.setState({ items: [] });
    render(<Activity rpc={rpcMock} />);
    rpcMock.events.dispatchEvent({ type: 'status.update', payload: {} });
    await waitFor(() => expect(screen.getByText(/All clear/i)).toBeInTheDocument());
  });
});
