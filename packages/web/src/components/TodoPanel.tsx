import { useMemo } from 'react';
import type { ToolCall } from '@hermes-pwa/core';
import { Icon } from './Icon';

type TodoStatus = 'pending' | 'in_progress' | 'completed' | 'cancelled';

interface TodoItem {
  id: string;
  content: string;
  status: TodoStatus;
}

function isStatus(value: unknown): value is TodoStatus {
  return typeof value === 'string' && ['pending', 'in_progress', 'completed', 'cancelled'].includes(value);
}

function parseTodos(value: unknown, depth = 0): TodoItem[] | null {
  if (depth > 2) return null;

  if (Array.isArray(value)) {
    const items: TodoItem[] = [];
    for (const item of value) {
      if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
      const row = item as Record<string, unknown>;
      const id = String(row.id ?? '').trim();
      const content = String(row.content ?? '').trim();
      if (!id || !content || !isStatus(row.status)) continue;
      items.push({ id, content, status: row.status });
    }
    return items;
  }

  if (typeof value === 'string' && value.trim()) {
    try {
      return parseTodos(JSON.parse(value), depth + 1);
    } catch {
      return null;
    }
  }

  if (value && typeof value === 'object' && !Array.isArray(value) && Object.hasOwn(value as Record<string, unknown>, 'todos')) {
    return parseTodos((value as Record<string, unknown>).todos, depth + 1);
  }

  return null;
}

function headerLabel(todos: TodoItem[]): string {
  return (
    todos.find((t) => t.status === 'in_progress')?.content ??
    todos.find((t) => t.status === 'pending')?.content ??
    todos.at(-1)?.content ??
    'Tasks'
  );
}

interface TodoPanelProps {
  tool: ToolCall;
}

export function TodoPanel({ tool }: TodoPanelProps) {
  const todos = useMemo(() => parseTodos(tool.output), [tool]);

  if (!todos || todos.length === 0) return null;

  const label = headerLabel(todos);

  return (
    <div className="hm-todo-panel">
      <div className="hm-todo-panel__header" title={label}>
        <span className="hm-todo-panel__title">{label}</span>
      </div>
      <ul className="hm-todo-panel__list">
        {todos.map((todo) => (
          <li
            key={todo.id}
            className={`hm-todo-panel__item ${todo.status === 'in_progress' ? 'hm-todo-panel__item--active' : 'hm-todo-panel__item--done'}`}
          >
            <span className="hm-todo-panel__check">
              {todo.status === 'in_progress' ? (
                <span className="hm-todo-panel__spinner" aria-label="In progress" />
              ) : (
                <Icon name={todo.status === 'completed' ? 'check' : 'terminal'} size={12} />
              )}
            </span>
            <span className="hm-todo-panel__text">{todo.content}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
