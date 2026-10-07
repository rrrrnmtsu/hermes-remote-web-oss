/**
 * Skill registry domain types.
 */

export interface Skill {
  id: string;
  name: string;
  description?: string | undefined;
  version?: string | undefined;
  enabled: boolean;
}

export function toSkill(raw: Record<string, unknown>): Skill {
  return {
    id: String(raw.id ?? raw.name ?? ''),
    name: String(raw.name ?? raw.id ?? 'Skill'),
    description: typeof raw.description === 'string' ? raw.description : undefined,
    version: typeof raw.version === 'string' ? raw.version : undefined,
    enabled: raw.enabled !== false && raw.active !== false,
  };
}
