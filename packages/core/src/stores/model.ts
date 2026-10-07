import { create } from 'zustand';
import type {
  AuxiliaryModels,
  ModelAssignmentResult,
  ModelInfo,
  ModelOptions,
} from '../domain/model';
import type { ReasoningEffort } from '../domain/profile';
import type { RestClient } from '../transport/rest';

export interface ModelStore {
  options: ModelOptions | undefined;
  info: ModelInfo | undefined;
  auxiliary: AuxiliaryModels | undefined;
  loading: boolean;
  setting: boolean;
  error: string | undefined;

  loadOptions(rest: RestClient): Promise<void>;
  loadInfo(rest: RestClient): Promise<void>;
  loadAuxiliary(rest: RestClient): Promise<void>;
  setMainModel(
    rest: RestClient,
    provider: string,
    model: string,
    confirm?: boolean,
    profile?: string,
    reasoningEffort?: ReasoningEffort,
    showReasoning?: boolean,
  ): Promise<ModelAssignmentResult>;
  clear(): void;
}

export const useModelStore = create<ModelStore>((set, get) => ({
  options: undefined,
  info: undefined,
  auxiliary: undefined,
  loading: false,
  setting: false,
  error: undefined,

  async loadOptions(rest) {
    set({ loading: true, error: undefined });
    try {
      const options = await rest.modelOptions();
      set({ options, loading: false });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to load model options';
      set({ loading: false, error: msg });
    }
  },

  async loadInfo(rest) {
    try {
      const info = await rest.modelInfo();
      set({ info });
    } catch {
      set({ info: undefined });
    }
  },

  async loadAuxiliary(rest) {
    try {
      const auxiliary = await rest.modelAuxiliary();
      set({ auxiliary });
    } catch {
      set({ auxiliary: undefined });
    }
  },

  async setMainModel(rest, provider, model, confirm = false, profile, reasoningEffort, showReasoning) {
    set({ setting: true, error: undefined });
    try {
      const result = profile
        ? await rest.profileUpdateModel(profile, {
            provider,
            model,
            ...(reasoningEffort ? { reasoning_effort: reasoningEffort } : {}),
            ...(showReasoning !== undefined ? { show_reasoning: showReasoning } : {}),
          })
        : await rest.modelSet({
            scope: 'main',
            provider,
            model,
            confirm_expensive_model: confirm,
          });
      if (result.confirm_required && !confirm) {
        set({ setting: false });
        return result;
      }
      await get().loadOptions(rest);
      if (!profile) await get().loadInfo(rest);
      set({ setting: false });
      return result;
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to set model';
      set({ setting: false, error: msg });
      throw err;
    }
  },

  clear() {
    set({ options: undefined, info: undefined, auxiliary: undefined, loading: false, setting: false, error: undefined });
  },
}));
