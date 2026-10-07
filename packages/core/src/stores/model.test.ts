import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useModelStore } from './model';
import type { RestClient } from '../transport/rest';

const makeRest = (overrides: Partial<RestClient> = {}) => ({
  modelOptions: vi.fn().mockResolvedValue({ provider: 'openai-codex', model: 'gpt-5.5', providers: [] }),
  modelInfo: vi.fn().mockResolvedValue({ provider: 'openai-codex', model: 'gpt-5.5', capabilities: {} }),
  modelSet: vi.fn().mockResolvedValue({ ok: true, provider: 'openai-codex', model: 'gpt-5' }),
  profileUpdateModel: vi.fn().mockResolvedValue({ ok: true, provider: 'anthropic', model: 'claude-sonnet-4' }),
  ...overrides,
}) as unknown as RestClient;

describe('useModelStore', () => {
  beforeEach(() => {
    useModelStore.setState({ options: undefined, info: undefined, auxiliary: undefined, loading: false, setting: false, error: undefined });
  });

  it('sets the global main model when no profile is supplied', async () => {
    const rest = makeRest();
    await useModelStore.getState().setMainModel(rest, 'openai-codex', 'gpt-5');

    expect(rest.modelSet).toHaveBeenCalledWith({
      scope: 'main',
      provider: 'openai-codex',
      model: 'gpt-5',
      confirm_expensive_model: false,
    });
    expect(rest.profileUpdateModel).not.toHaveBeenCalled();
    expect(rest.modelInfo).toHaveBeenCalled();
  });

  it('sets the selected profile model without touching the global model endpoint', async () => {
    const rest = makeRest();
    await useModelStore.getState().setMainModel(rest, 'anthropic', 'claude-sonnet-4', false, 'research', 'medium', true);

    expect(rest.profileUpdateModel).toHaveBeenCalledWith('research', {
      provider: 'anthropic',
      model: 'claude-sonnet-4',
      reasoning_effort: 'medium',
      show_reasoning: true,
    });
    expect(rest.modelSet).not.toHaveBeenCalled();
    expect(rest.modelInfo).not.toHaveBeenCalled();
    expect(rest.modelOptions).toHaveBeenCalled();
  });
});
