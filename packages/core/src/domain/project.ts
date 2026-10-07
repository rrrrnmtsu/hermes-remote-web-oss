/**
 * Project / kanban domain types.
 *
 * Mirrors the kanban dashboard plugin API contract documented in
 * /home/stasstep/.hermes/hermes-agent/plugins/kanban/dashboard/plugin_api.py
 */

export type TaskStatus =
  | 'triage'
  | 'todo'
  | 'scheduled'
  | 'ready'
  | 'running'
  | 'blocked'
  | 'review'
  | 'done'
  | 'archived'
  // Legacy aliases kept for compatibility with older mocks/tests.
  | 'backlog'
  | 'in_progress';

const KNOWN_STATUSES = new Set<TaskStatus>([
  'triage',
  'todo',
  'scheduled',
  'ready',
  'running',
  'blocked',
  'review',
  'done',
  'archived',
  'backlog',
  'in_progress',
]);

function normalizeStatus(raw: unknown): TaskStatus {
  if (typeof raw !== 'string') return 'backlog';
  const s = raw.toLowerCase().replace(/\s+/g, '_') as TaskStatus;
  return KNOWN_STATUSES.has(s) ? s : 'backlog';
}

export interface Comment {
  id: number;
  taskId: string;
  author: string;
  body: string;
  createdAt: number;
}

export interface Task {
  id: string;
  title: string;
  status: TaskStatus;
  createdAt: number;
  // Optional detail fields
  body?: string;
  assignee?: string;
  priority?: number;
  tenant?: string;
  commentCount?: number;
  latestSummary?: string;
  // Deprecated / UI-only
  description?: string;
  run?: string;
  block?: string;
}

export interface Board {
  slug: string;
  name: string;
  taskCount: number;
  isCurrent?: boolean;
  // Kept for callers that still pass an id; slug is the canonical identifier.
  id?: string;
}

export interface Worker {
  name: string;
  task: string;
  active?: boolean;
}

export interface Column {
  status: TaskStatus;
  tasks: Task[];
}

export interface BoardDetail {
  slug: string;
  name: string;
  columns: Column[];
}

export interface TaskDetail {
  task: Task;
  comments: Comment[];
}

export function toBoard(raw: Record<string, unknown>): Board {
  const slug = String(raw.slug ?? raw.id ?? '');
  const total =
    typeof raw.total === 'number'
      ? raw.total
      : typeof raw.task_count === 'number'
        ? raw.task_count
        : 0;
  const id = raw.id !== undefined ? String(raw.id) : slug;
  return {
    slug,
    id,
    name: typeof raw.name === 'string' ? raw.name : 'Untitled board',
    taskCount: total,
    isCurrent: raw.is_current === true,
  };
}

export function toComment(raw: Record<string, unknown>): Comment {
  return {
    id: typeof raw.id === 'number' ? raw.id : 0,
    taskId: String(raw.task_id ?? ''),
    author: typeof raw.author === 'string' ? raw.author : 'dashboard',
    body: typeof raw.body === 'string' ? raw.body : '',
    createdAt: typeof raw.created_at === 'number' ? raw.created_at : Date.now(),
  };
}

export function toTask(raw: Record<string, unknown>): Task {
  const out: Task = {
    id: String(raw.id ?? ''),
    title: typeof raw.title === 'string' ? raw.title : 'Untitled',
    status: normalizeStatus(raw.status),
    createdAt: typeof raw.created_at === 'number' ? raw.created_at : Date.now(),
  };
  if (typeof raw.body === 'string') out.body = raw.body;
  if (typeof raw.description === 'string') out.description = raw.description;
  if (typeof raw.assignee === 'string') out.assignee = raw.assignee;
  if (typeof raw.priority === 'number') out.priority = raw.priority;
  else if (typeof raw.priority === 'string') out.priority = Number(raw.priority) || 0;
  if (typeof raw.tenant === 'string') out.tenant = raw.tenant;
  if (typeof raw.comment_count === 'number') out.commentCount = raw.comment_count;
  if (typeof raw.latest_summary === 'string') out.latestSummary = raw.latest_summary;
  if (typeof raw.run === 'string') out.run = raw.run;
  if (typeof raw.block === 'string') out.block = raw.block;
  return out;
}

export function toWorker(raw: Record<string, unknown>): Worker {
  return {
    name: typeof raw.name === 'string' ? raw.name : 'worker',
    task: typeof raw.task === 'string' ? raw.task : '—',
    active: raw.active !== false,
  };
}

export function toBoardDetail(raw: Record<string, unknown>): BoardDetail {
  const columns: Column[] = [];

  if (Array.isArray(raw.columns)) {
    for (const col of raw.columns) {
      if (typeof col !== 'object' || col === null) continue;
      const c = col as Record<string, unknown>;
      const status = normalizeStatus(c.name ?? c.status);
      const tasks = Array.isArray(c.tasks)
        ? (c.tasks as Record<string, unknown>[]).map((t) => ({ ...toTask(t), status }))
        : [];
      columns.push({ status, tasks });
    }
  }

  // Fallback for legacy / mock payloads that still return flat tasks.
  if (columns.length === 0 && Array.isArray(raw.tasks)) {
    const tasks = (raw.tasks as Record<string, unknown>[]).map(toTask);
    const known: TaskStatus[] = ['backlog', 'in_progress', 'review', 'done', 'blocked'];
    for (const status of known) {
      columns.push({ status, tasks: tasks.filter((t) => t.status === status) });
    }
  }

  return {
    slug: String(raw.slug ?? ''),
    name: typeof raw.name === 'string' ? raw.name : 'Untitled board',
    columns,
  };
}

export function toTaskDetail(raw: Record<string, unknown>): TaskDetail {
  const task = toTask((raw.task as Record<string, unknown>) ?? {});
  const comments = Array.isArray(raw.comments)
    ? (raw.comments as Record<string, unknown>[]).map(toComment)
    : [];
  return { task, comments };
}
