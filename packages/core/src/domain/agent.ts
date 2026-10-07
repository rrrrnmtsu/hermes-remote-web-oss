/**
 * Agent / profile domain types.
 */

export interface AgentProfile {
  id: string;
  name: string;
  model?: string;
  provider?: string;
  status: 'idle' | 'busy' | 'offline';
  description?: string;
}

export function toAgentProfile(raw: Record<string, unknown>): AgentProfile {
  const out: AgentProfile = {
    id: String(raw.id ?? ''),
    name: typeof raw.name === 'string' ? raw.name : 'Unknown',
    status: (raw.status as AgentProfile['status']) ?? 'offline',
  };
  if (typeof raw.model === 'string') out.model = raw.model;
  if (typeof raw.provider === 'string') out.provider = raw.provider;
  if (typeof raw.description === 'string') out.description = raw.description;
  return out;
}
