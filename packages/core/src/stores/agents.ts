import { create } from 'zustand';
import type { AgentProfile } from '../domain/agent';
import { toAgentProfile } from '../domain/agent';
import type { RpcClient } from '../transport/jsonrpc';

export interface AgentsStore {
  agents: AgentProfile[];
  loading: boolean;
  error: string | undefined;

  load(rpc: RpcClient): Promise<void>;
  clear(): void;
}

export const useAgentsStore = create<AgentsStore>((set) => ({
  agents: [],
  loading: false,
  error: undefined,

  async load(rpc) {
    set({ loading: true, error: undefined });
    try {
      const raw = await rpc.request<Record<string, unknown>[]>('agents.list', {});
      const agents = Array.isArray(raw) ? raw.map(toAgentProfile) : [];
      set({ agents, loading: false });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to load agents.';
      set({ loading: false, error: msg });
    }
  },

  clear() {
    set({ agents: [], loading: false, error: undefined });
  },
}));
