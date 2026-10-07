import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useAgentsStore } from './agents';
import type { RpcClient } from '../transport/jsonrpc';

describe('useAgentsStore', () => {
  let rpcMock: RpcClient;

  beforeEach(() => {
    useAgentsStore.setState({ agents: [], loading: false, error: undefined });
    rpcMock = {
      request: vi.fn(),
      onFrame: vi.fn(),
      events: new EventTarget(),
    } as unknown as RpcClient;
  });

  it('loads agents', async () => {
    vi.mocked(rpcMock.request).mockResolvedValue([
      { id: 'p-1', name: 'Coder', model: 'gpt-4', provider: 'openai', status: 'idle', description: 'A coder' },
      { id: 'p-2', name: 123, model: 456, status: null },
    ]);
    await useAgentsStore.getState().load(rpcMock);
    expect(useAgentsStore.getState().agents).toHaveLength(2);
    expect(useAgentsStore.getState().agents[0]?.name).toBe('Coder');
    expect(useAgentsStore.getState().agents[0]?.model).toBe('gpt-4');
    expect(useAgentsStore.getState().agents[0]?.provider).toBe('openai');
    expect(useAgentsStore.getState().agents[0]?.status).toBe('idle');
    expect(useAgentsStore.getState().agents[0]?.description).toBe('A coder');
    expect(useAgentsStore.getState().agents[1]?.name).toBe('Unknown');
    expect(useAgentsStore.getState().agents[1]?.model).toBeUndefined();
    expect(useAgentsStore.getState().agents[1]?.status).toBe('offline');
    expect(useAgentsStore.getState().loading).toBe(false);
  });

  it('load handles non-array', async () => {
    vi.mocked(rpcMock.request).mockResolvedValue(null);
    await useAgentsStore.getState().load(rpcMock);
    expect(useAgentsStore.getState().agents).toEqual([]);
  });

  it('load handles error', async () => {
    vi.mocked(rpcMock.request).mockRejectedValue(new Error('down'));
    await useAgentsStore.getState().load(rpcMock);
    expect(useAgentsStore.getState().error).toBe('down');
    expect(useAgentsStore.getState().loading).toBe(false);
  });

  it('load handles non-error rejection', async () => {
    vi.mocked(rpcMock.request).mockRejectedValue('fail');
    await useAgentsStore.getState().load(rpcMock);
    expect(useAgentsStore.getState().error).toBe('Failed to load agents.');
  });

  it('load handles non-array', async () => {
    vi.mocked(rpcMock.request).mockResolvedValue(null);
    await useAgentsStore.getState().load(rpcMock);
    expect(useAgentsStore.getState().agents).toEqual([]);
    expect(useAgentsStore.getState().loading).toBe(false);
  });

  it('clear resets', () => {
    useAgentsStore.setState({ agents: [{ id: 'p-1', name: 'Coder', status: 'idle' }] });
    useAgentsStore.getState().clear();
    expect(useAgentsStore.getState().agents).toEqual([]);
    expect(useAgentsStore.getState().error).toBeUndefined();
  });
});
