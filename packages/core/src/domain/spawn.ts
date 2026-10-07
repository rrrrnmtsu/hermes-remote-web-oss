export type SpawnStatus = 'running' | 'queued' | 'completed' | 'failed' | 'interrupted';
export type StreamKind = 'progress' | 'summary' | 'thinking' | 'tool';

export interface StreamEntry {
  at: number;
  kind: StreamKind;
  text: string;
  isError?: boolean;
}

export interface SpawnedAgent {
  id: string;
  parentId: string | null;
  sessionId: string;
  goal: string;
  model?: string;
  status: SpawnStatus;
  taskIndex: number;
  taskCount: number;
  startedAt: number;
  updatedAt: number;
  durationSeconds?: number;
  inputTokens?: number;
  outputTokens?: number;
  costUsd?: number;
  toolCount?: number;
  filesRead: string[];
  filesWritten: string[];
  stream: StreamEntry[];
}

export interface SpawnNode extends SpawnedAgent {
  children: SpawnNode[];
}

const TERMINAL: ReadonlySet<SpawnStatus> = new Set(['completed', 'failed', 'interrupted']);
const MAX_STREAM = 24;

const str = (v: unknown): string => (typeof v === 'string' ? v : '');
const num = (v: unknown): number | undefined =>
  typeof v === 'number' && Number.isFinite(v) ? v : undefined;
const strList = (v: unknown): string[] =>
  Array.isArray(v) ? (v as unknown[]).filter((x): x is string => typeof x === 'string') : [];
const asStatus = (v: unknown): SpawnStatus =>
  v === 'completed' || v === 'failed' || v === 'interrupted' || v === 'queued' ? v : 'running';

function compact(text: string, max = 220): string {
  const line = text.replace(/\s+/g, ' ').trim();
  return line.length > max ? `${line.slice(0, max - 1)}…` : line;
}

export function agentIdFromPayload(p: Record<string, unknown>): string {
  return (
    str(p.subagent_id) ||
    `${str(p.parent_id) || 'root'}:${String(num(p.task_index) ?? 0)}:${str(p.goal)}`
  );
}

export function agentFromPayload(
  p: Record<string, unknown>,
  sessionId: string,
): SpawnedAgent {
  const id = agentIdFromPayload(p);
  const status = asStatus(p.status);
  const toolName = str(p.tool_name);
  const toolPreview = str(p.tool_preview) || str(p.text);
  const text = compact(str(p.text) || toolPreview);

  const stream: StreamEntry[] = [];
  if (toolName && !TERMINAL.has(status)) {
    const snippet = toolPreview ? compact(toolPreview, 96) : '';
    const label = toolName
      .split('_')
      .filter(Boolean)
      .map((w) => w[0]!.toUpperCase() + w.slice(1))
      .join(' ');
    stream.push({ at: Date.now(), kind: 'tool', text: snippet ? `${label}("${snippet}")` : label });
  } else if (text) {
    stream.push({ at: Date.now(), kind: 'progress', text });
  }

  const agent: SpawnedAgent = {
    id,
    parentId: str(p.parent_id) || null,
    sessionId,
    goal: str(p.goal) || 'Task',
    status,
    taskIndex: num(p.task_index) ?? 0,
    taskCount: num(p.task_count) ?? 1,
    startedAt: num(p.started_at) ?? Date.now(),
    updatedAt: num(p.updated_at) ?? Date.now(),
    filesRead: strList(p.files_read),
    filesWritten: strList(p.files_written),
    stream,
  };
  const model = str(p.model);
  if (model) agent.model = model;
  const durationSeconds = num(p.duration_seconds);
  if (durationSeconds !== undefined) agent.durationSeconds = durationSeconds;
  const inputTokens = num(p.input_tokens);
  if (inputTokens !== undefined) agent.inputTokens = inputTokens;
  const outputTokens = num(p.output_tokens);
  if (outputTokens !== undefined) agent.outputTokens = outputTokens;
  const costUsd = num(p.cost_usd);
  if (costUsd !== undefined) agent.costUsd = costUsd;
  const toolCount = num(p.tool_count);
  if (toolCount !== undefined) agent.toolCount = toolCount;
  return agent;
}

export function mergeAgent(existing: SpawnedAgent, p: Record<string, unknown>): SpawnedAgent {
  const status = asStatus(p.status);
  const toolName = str(p.tool_name);
  const toolPreview = str(p.tool_preview) || str(p.text);
  const text = compact(str(p.text) || toolPreview);

  let newEntry: StreamEntry | null = null;
  if (toolName && !TERMINAL.has(status)) {
    const snippet = toolPreview ? compact(toolPreview, 96) : '';
    const label = toolName
      .split('_')
      .filter(Boolean)
      .map((w) => w[0]!.toUpperCase() + w.slice(1))
      .join(' ');
    newEntry = { at: Date.now(), kind: 'tool', text: snippet ? `${label}("${snippet}")` : label };
  } else if (text) {
    newEntry = { at: Date.now(), kind: 'progress', text };
  }

  const prevStream = existing.stream;
  let stream = prevStream;
  if (newEntry) {
    const last = prevStream.at(-1);
    const isDupe =
      last && last.kind === newEntry.kind && last.text === newEntry.text && !last.isError;
    if (!isDupe) {
      stream = [...prevStream, newEntry].slice(-MAX_STREAM);
    }
  }
  if (TERMINAL.has(status)) {
    const streamText = str(p.summary) || str(p.text);
    if (streamText) {
      stream = [...stream, { at: Date.now(), kind: 'summary' as StreamKind, text: compact(streamText) }].slice(-MAX_STREAM);
    }
  }

  const merged: SpawnedAgent = {
    ...existing,
    status,
    updatedAt: num(p.updated_at) ?? Date.now(),
    filesRead: strList(p.files_read).length ? strList(p.files_read) : existing.filesRead,
    filesWritten: strList(p.files_written).length ? strList(p.files_written) : existing.filesWritten,
    stream,
  };
  const durationSeconds = num(p.duration_seconds) ?? existing.durationSeconds;
  if (durationSeconds !== undefined) merged.durationSeconds = durationSeconds;
  const inputTokens = num(p.input_tokens) ?? existing.inputTokens;
  if (inputTokens !== undefined) merged.inputTokens = inputTokens;
  const outputTokens = num(p.output_tokens) ?? existing.outputTokens;
  if (outputTokens !== undefined) merged.outputTokens = outputTokens;
  const costUsd = num(p.cost_usd) ?? existing.costUsd;
  if (costUsd !== undefined) merged.costUsd = costUsd;
  const toolCount = num(p.tool_count) ?? existing.toolCount;
  if (toolCount !== undefined) merged.toolCount = toolCount;
  return merged;
}

export function buildSpawnTree(agents: SpawnedAgent[]): SpawnNode[] {
  const map = new Map<string, SpawnNode>();
  for (const a of agents) {
    map.set(a.id, { ...a, children: [] });
  }
  const roots: SpawnNode[] = [];
  for (const node of map.values()) {
    if (node.parentId && map.has(node.parentId)) {
      map.get(node.parentId)!.children.push(node);
    } else {
      roots.push(node);
    }
  }
  return roots;
}
