import { create } from 'zustand';
import {
  type SpawnedAgent,
  type SpawnNode,
  agentIdFromPayload,
  agentFromPayload,
  mergeAgent,
  buildSpawnTree,
} from '../domain/spawn';

export interface SpawnStore {
  sessionId: string | undefined;
  agents: SpawnedAgent[];
  tree: SpawnNode[];

  setSession(sessionId: string): void;
  handleEvent(type: string, payload: Record<string, unknown>): void;
  clear(): void;
}

export const useSpawnStore = create<SpawnStore>((set, get) => ({
  sessionId: undefined,
  agents: [],
  tree: [],

  setSession(sessionId) {
    if (get().sessionId === sessionId) return;
    set({ sessionId, agents: [], tree: [] });
  },

  handleEvent(type, payload) {
    const sessionId = get().sessionId;
    if (!sessionId) return;

    const payloadSession = typeof payload.session_id === 'string' ? payload.session_id : undefined;
    if (payloadSession && payloadSession !== sessionId) return;

    const id = agentIdFromPayload(payload);
    const current = get().agents;

    let updated: SpawnedAgent[];
    if (type === 'subagent.started') {
      if (current.some((a) => a.id === id)) {
        updated = current.map((a) => (a.id === id ? mergeAgent(a, payload) : a));
      } else {
        updated = [...current, agentFromPayload(payload, sessionId)];
      }
    } else if (type === 'subagent.update' || type === 'subagent.progress') {
      if (current.some((a) => a.id === id)) {
        updated = current.map((a) => (a.id === id ? mergeAgent(a, payload) : a));
      } else {
        updated = [...current, agentFromPayload(payload, sessionId)];
      }
    } else if (type === 'subagent.finished' || type === 'subagent.completed') {
      updated = current.map((a) => (a.id === id ? mergeAgent(a, { ...payload, status: 'completed' }) : a));
    } else if (type === 'subagent.failed') {
      updated = current.map((a) => (a.id === id ? mergeAgent(a, { ...payload, status: 'failed' }) : a));
    } else {
      return;
    }

    set({ agents: updated, tree: buildSpawnTree(updated) });
  },

  clear() {
    set({ sessionId: undefined, agents: [], tree: [] });
  },
}));
