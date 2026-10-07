export interface ModelCapabilities {
  supports_tools?: boolean;
  supports_vision?: boolean;
  supports_reasoning?: boolean;
  context_window?: number;
  max_output_tokens?: number;
  model_family?: string;
}

export interface ModelProvider {
  name: string;
  slug: string;
  models: string[];
  authenticated?: boolean;
  isCurrent?: boolean;
  source?: string;
  warning?: string;
}

export interface ModelOptions {
  model?: string;
  provider?: string;
  providers: ModelProvider[];
}

export interface ModelInfo {
  model: string;
  provider: string;
  capabilities: ModelCapabilities;
}

export interface AuxiliaryModel {
  task: string;
  provider: string;
  model: string;
  base_url?: string;
}

export interface AuxiliaryModels {
  main: { provider: string; model: string };
  tasks: AuxiliaryModel[];
}

export interface ModelAssignment {
  scope: 'main' | 'auxiliary';
  provider: string;
  model: string;
  task?: string;
  base_url?: string;
  confirm_expensive_model?: boolean;
}

export interface ModelAssignmentResult {
  ok: boolean;
  scope?: string;
  provider?: string;
  model?: string;
  confirm_required?: boolean;
  confirm_message?: string;
}

export function toModelProvider(raw: Record<string, unknown>): ModelProvider {
  const provider: ModelProvider = {
    name: String(raw.name ?? raw.slug ?? 'unknown'),
    slug: String(raw.slug ?? raw.name ?? 'unknown'),
    models: [],
  };
  if (Array.isArray(raw.models)) {
    provider.models = raw.models.map((m) => (typeof m === 'string' ? m : String(m)));
  }
  if (raw.authenticated === true) provider.authenticated = true;
  if (raw.is_current === true) provider.isCurrent = true;
  if (typeof raw.source === 'string') provider.source = raw.source;
  if (typeof raw.warning === 'string') provider.warning = raw.warning;
  return provider;
}

export function toModelOptions(raw: Record<string, unknown>): ModelOptions {
  const options: ModelOptions = { providers: [] };
  if (typeof raw.model === 'string') options.model = raw.model;
  if (typeof raw.provider === 'string') options.provider = raw.provider;
  if (Array.isArray(raw.providers)) {
    options.providers = raw.providers
      .filter((p): p is Record<string, unknown> => typeof p === 'object' && p !== null)
      .map(toModelProvider);
  }
  return options;
}

export function toModelInfo(raw: Record<string, unknown>): ModelInfo {
  const capabilities: ModelCapabilities = {};
  if (raw.capabilities !== undefined && typeof raw.capabilities === 'object') {
    const c = raw.capabilities as Record<string, unknown>;
    if (c.supports_tools === true) capabilities.supports_tools = true;
    if (c.supports_vision === true) capabilities.supports_vision = true;
    if (c.supports_reasoning === true) capabilities.supports_reasoning = true;
    if (typeof c.context_window === 'number') capabilities.context_window = c.context_window;
    if (typeof c.max_output_tokens === 'number') capabilities.max_output_tokens = c.max_output_tokens;
    if (typeof c.model_family === 'string') capabilities.model_family = c.model_family;
  }
  return {
    model: typeof raw.model === 'string' ? raw.model : '',
    provider: typeof raw.provider === 'string' ? raw.provider : '',
    capabilities,
  };
}

export function toAuxiliaryModels(raw: Record<string, unknown>): AuxiliaryModels {
  const main = (raw.main ?? {}) as Record<string, unknown>;
  const tasks = Array.isArray(raw.tasks)
    ? raw.tasks
        .filter((t): t is Record<string, unknown> => typeof t === 'object' && t !== null)
        .map((t) => ({
          task: String(t.task ?? ''),
          provider: String(t.provider ?? ''),
          model: String(t.model ?? ''),
          ...(typeof t.base_url === 'string' ? { base_url: t.base_url } : {}),
        }))
    : [];
  return {
    main: {
      provider: String(main.provider ?? ''),
      model: String(main.model ?? ''),
    },
    tasks,
  };
}

export function toModelAssignmentResult(raw: Record<string, unknown>): ModelAssignmentResult {
  const result: ModelAssignmentResult = { ok: raw.ok === true };
  if (typeof raw.scope === 'string') result.scope = raw.scope as 'main' | 'auxiliary';
  if (typeof raw.provider === 'string') result.provider = raw.provider;
  if (typeof raw.model === 'string') result.model = raw.model;
  if (raw.confirm_required === true) {
    result.confirm_required = true;
    if (typeof raw.confirm_message === 'string') result.confirm_message = raw.confirm_message;
  }
  return result;
}
