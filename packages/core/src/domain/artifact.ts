/**
 * Session artifact domain types.
 */

export interface Artifact {
  id: string;
  name: string;
  type: string;
  path: string;
  createdAt: number;
}

export function toArtifact(raw: Record<string, unknown>): Artifact {
  const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);
  return {
    id: String(raw.id ?? raw.artifact_id ?? ''),
    name: String(raw.name ?? raw.filename ?? raw.id ?? 'Artifact'),
    type: String(raw.type ?? raw.content_type ?? 'file'),
    path: String(raw.path ?? raw.url ?? raw.id ?? ''),
    createdAt: num(raw.created_at ?? raw.createdAt) ?? Date.now(),
  };
}
