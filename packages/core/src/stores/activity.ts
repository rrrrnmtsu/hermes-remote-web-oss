import { create } from 'zustand';
import type { ActionItem } from '../domain/activity';
import type { RpcClient } from '../transport/jsonrpc';
import type { RestClient } from '../transport/rest';

export interface ActivityStore {
  items: ActionItem[];
  loading: boolean;
  error: string | undefined;

  load(rest: RestClient, profile?: string): Promise<void>;
  respondApproval(
    rpc: RpcClient,
    id: string,
    decision: 'approve' | 'reject',
    sessionId?: string,
    choiceOverride?: 'once' | 'session' | 'always' | 'deny',
  ): Promise<void>;
  respondClarify(rpc: RpcClient, id: string, answer: string): Promise<void>;
  dismiss(id: string): void;
  addItem(item: ActionItem): void;
  updateItem(id: string, patch: Partial<ActionItem>): void;
  clear(): void;
}

function updateInPlace(items: ActionItem[], id: string, patch: Partial<ActionItem>): ActionItem[] {
  return items.map((i) => (i.id === id ? { ...i, ...patch } : i));
}

function removeById(items: ActionItem[], id: string): ActionItem[] {
  return items.filter((i) => i.id !== id);
}

const EQUIVALENT_APPROVAL_WINDOW_MS = 2 * 60_000;

function toMillis(value: number | undefined): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined;
  // Backend pending records use epoch seconds; UI-created realtime cards use ms.
  return value > 1_000_000_000_000 ? value : value > 1_000_000_000 ? value * 1000 : value;
}

function approvalIds(item: ActionItem): string[] {
  return [item.sessionId, item.sourceSessionId].filter((value): value is string => Boolean(value));
}

function sameApproval(a: ActionItem, b: ActionItem): boolean {
  if (a.kind !== 'approval' || b.kind !== 'approval') return false;
  if (!a.summary || !b.summary || a.summary !== b.summary) return false;

  // The same backend approval can reach the UI twice:
  // - realtime WS event, sometimes keyed by the live UI session id;
  // - REST recovery record, keyed by the gateway approval session_key.
  // Prefer exact/source id overlap when available, but tolerate a short timing
  // window so an already-open PWA can collapse old-bundle realtime cards whose
  // id shape differs from the REST recovery record.
  const aIds = approvalIds(a);
  const bIds = approvalIds(b);
  if (aIds.some((id) => bIds.includes(id))) return true;

  const aTime = toMillis(a.createdAt);
  const bTime = toMillis(b.createdAt);
  return Boolean(aTime !== undefined && bTime !== undefined && Math.abs(aTime - bTime) <= EQUIVALENT_APPROVAL_WINDOW_MS);
}

const REALTIME_APPROVAL_REFRESH_GRACE_MS = 5_000;
const approvalResponsesInFlight = new Set<string>();

function mergeIncomingItems(existing: ActionItem[], incoming: ActionItem[]): ActionItem[] {
  const now = Date.now();
  const rest = existing.filter((current) => {
    const replacedByIncoming = incoming.some((item) => item.id === current.id || sameApproval(item, current));
    if (replacedByIncoming) return false;

    // /actions/pending is the backend source of truth for approval cards, but
    // a websocket approval.request can arrive a moment before the REST recovery
    // file is visible to the next refresh. Keep very fresh realtime approvals
    // briefly; after that, if REST doesn't list it, the gateway queue has
    // resolved/timed out and the local card is stale.
    if (current.kind === 'approval') {
      return now - current.createdAt < REALTIME_APPROVAL_REFRESH_GRACE_MS;
    }

    return true;
  });
  return [...incoming, ...rest];
}

function upsertActivityItem(existing: ActionItem[], item: ActionItem): ActionItem[] {
  return [item, ...existing.filter((current) => current.id !== item.id && !sameApproval(item, current))];
}

function isStaleApprovalError(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err ?? '');
  return /no pending approval for session|no pending approval/i.test(message);
}

export const useActivityStore = create<ActivityStore>((set, get) => ({
  items: [],
  loading: false,
  error: undefined,

  async load(rest, profile) {
    set({ loading: true, error: undefined });
    try {
      const items = await rest.pendingActions(profile);
      set((s) => ({
        items: mergeIncomingItems(s.items, items),
        loading: false,
      }));
    } catch (err) {
      set({ loading: false, error: err instanceof Error ? err.message : 'Failed to load pending actions.' });
    }
  },

  async respondApproval(rpc, id, decision, sessionId, choiceOverride) {
    if (approvalResponsesInFlight.has(id)) return;
    approvalResponsesInFlight.add(id);
    try {
      const item = get().items.find((i) => i.id === id);
      const resolvedSessionId = sessionId ?? item?.sessionId;
      if (!resolvedSessionId) {
        throw new Error('Approval response requires session_id.');
      }
      const choice = choiceOverride ?? (decision === 'approve' ? 'once' : 'deny');
      await rpc.request('approval.respond', {
        choice,
        session_id: resolvedSessionId,
      });
      set((s) => ({ items: removeById(s.items, id) }));
    } catch (err) {
      if (isStaleApprovalError(err)) {
        const msg = 'Approval expired or was already handled.';
        set((s) => ({ items: removeById(s.items, id), error: msg }));
        return;
      }
      const msg = err instanceof Error ? err.message : 'Failed to respond.';
      set({ error: msg });
      throw err;
    } finally {
      approvalResponsesInFlight.delete(id);
    }
  },

  async respondClarify(rpc, id, answer) {
    try {
      await rpc.request('clarify.respond', { id, answer });
      set((s) => ({ items: removeById(s.items, id) }));
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to respond.';
      set({ error: msg });
      throw err;
    }
  },

  dismiss(id) {
    set((s) => ({ items: removeById(s.items, id) }));
  },

  addItem(item) {
    set((s) => ({
      items: upsertActivityItem(s.items, item),
    }));
  },

  updateItem(id, patch) {
    set((s) => ({ items: updateInPlace(s.items, id, patch) }));
  },

  clear() {
    set({ items: [], loading: false, error: undefined });
  },
}));
