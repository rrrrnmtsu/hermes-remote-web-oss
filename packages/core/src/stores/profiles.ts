import { create } from 'zustand';
import type { Profile, ProfileActive, ProfileCreateBody, ReasoningEffort } from '../domain/profile';
import type { RestClient } from '../transport/rest';

export interface ProfilesStore {
  profiles: Profile[];
  /** Profile selected in the UI (may differ from the backend's running profile). */
  activeName: string | undefined;
  /** Profile the gateway process is actually running (server-side). */
  currentName: string | undefined;
  loading: boolean;
  error: string | undefined;

  load(rest: RestClient): Promise<void>;
  activate(rest: RestClient, name: string): Promise<void>;
  create(rest: RestClient, body: ProfileCreateBody): Promise<void>;
  rename(rest: RestClient, name: string, newName: string): Promise<void>;
  delete(rest: RestClient, name: string): Promise<void>;
  setModel(rest: RestClient, name: string, provider: string, model: string, reasoningEffort?: ReasoningEffort, showReasoning?: boolean): Promise<void>;
  clear(): void;
}

export const useProfilesStore = create<ProfilesStore>((set, get) => ({
  profiles: [],
  activeName: undefined,
  currentName: undefined,
  loading: false,
  error: undefined,

  async load(rest) {
    set({ loading: true, error: undefined });
    try {
      const [profiles, active] = await Promise.all([
        rest.profileList(),
        rest.profileActive().catch(() => ({ active: undefined, current: undefined } as ProfileActive)),
      ]);
      // `active` is the selected/sticky profile; `current` is the running gateway profile.
      const activeName = active.active ?? active.current ?? '';
      const currentName = active.current ?? active.active ?? '';
      const normalized = profiles.map((p) => ({ ...p, isActive: p.name === activeName }));
      set({ profiles: normalized, activeName: activeName || undefined, currentName: currentName || undefined, loading: false });
    } catch (err) {
      set({ loading: false, error: err instanceof Error ? err.message : 'Failed to load profiles' });
    }
  },

  async activate(rest, name) {
    try {
      await rest.profileActivate(name);
      const profiles = get().profiles.map((p) => ({ ...p, isActive: p.name === name }));
      set({ profiles, activeName: name });
    } catch (err) {
      set({ error: err instanceof Error ? err.message : 'Failed to activate profile' });
      throw err;
    }
  },

  async create(rest, body) {
    set({ loading: true, error: undefined });
    try {
      const result = await rest.profileCreate(body);
      if (!result.ok) throw new Error('Profile creation failed');
      await get().load(rest);
    } catch (err) {
      set({ loading: false, error: err instanceof Error ? err.message : 'Failed to create profile' });
      throw err;
    }
  },

  async rename(rest, name, newName) {
    set({ error: undefined });
    try {
      await rest.profileRename(name, newName);
      await get().load(rest);
    } catch (err) {
      set({ error: err instanceof Error ? err.message : 'Failed to rename profile' });
      throw err;
    }
  },

  async delete(rest, name) {
    set({ error: undefined });
    try {
      await rest.profileDelete(name);
      const profiles = get().profiles.filter((p) => p.name !== name);
      const activeName = get().activeName === name ? undefined : get().activeName;
      const currentName = get().currentName === name ? undefined : get().currentName;
      set({ profiles, activeName, currentName });
    } catch (err) {
      set({ error: err instanceof Error ? err.message : 'Failed to delete profile' });
      throw err;
    }
  },

  async setModel(rest, name, provider, model, reasoningEffort, showReasoning) {
    set({ error: undefined });
    try {
      await rest.profileUpdateModel(name, {
        provider,
        model,
        ...(reasoningEffort ? { reasoning_effort: reasoningEffort } : {}),
        ...(showReasoning !== undefined ? { show_reasoning: showReasoning } : {}),
      });
      const profiles = get().profiles.map((p) => {
        if (p.name !== name) return p;
        return {
          ...p,
          provider,
          model,
          ...(reasoningEffort !== undefined ? { reasoningEffort } : {}),
          ...(showReasoning !== undefined ? { showReasoning } : {}),
        };
      });
      set({ profiles });
      await get().load(rest);
    } catch (err) {
      set({ error: err instanceof Error ? err.message : 'Failed to update profile model' });
      throw err;
    }
  },

  clear() {
    set({ profiles: [], activeName: undefined, currentName: undefined, loading: false, error: undefined });
  },
}));
