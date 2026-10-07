import { describe, it, expect } from 'vitest';
import { toBoard, toTask } from './project';

describe('toBoard', () => {
  it('maps fields', () => {
    const b = toBoard({ id: 'b-1', slug: 'main', name: 'Main', task_count: 5 });
    expect(b.id).toBe('b-1');
    expect(b.slug).toBe('main');
    expect(b.name).toBe('Main');
    expect(b.taskCount).toBe(5);
  });

  it('defaults missing fields', () => {
    const b = toBoard({});
    expect(b.id).toBe('');
    expect(b.slug).toBe('');
    expect(b.name).toBe('Untitled board');
    expect(b.taskCount).toBe(0);
  });
});

describe('toTask', () => {
  it('maps fields', () => {
    const t = toTask({ id: 't-1', title: 'Fix bug', status: 'in_progress', assignee: 'alice', created_at: 123 });
    expect(t.id).toBe('t-1');
    expect(t.title).toBe('Fix bug');
    expect(t.status).toBe('in_progress');
    expect(t.assignee).toBe('alice');
    expect(t.createdAt).toBe(123);
  });

  it('defaults missing fields', () => {
    const t = toTask({});
    expect(t.id).toBe('');
    expect(t.title).toBe('Untitled');
    expect(t.status).toBe('backlog');
    expect(t.assignee).toBeUndefined();
    expect(t.createdAt).toBeGreaterThan(0);
  });
});
