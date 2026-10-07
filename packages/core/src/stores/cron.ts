import { create } from 'zustand';
import type { CronDeliveryTarget, CronJob, CronJobRun } from '../domain/cron';
import type { RestClient } from '../transport/rest';

export interface CronStore {
  jobs: CronJob[];
  deliveryTargets: CronDeliveryTarget[];
  selectedProfile: string;
  loading: boolean;
  actionLoading: string | null;
  error: string | undefined;

  setProfile(profile: string): void;
  loadJobs(rest: RestClient): Promise<void>;
  loadDeliveryTargets(rest: RestClient): Promise<void>;
  createJob(
    rest: RestClient,
    params: { prompt: string; schedule: string; name?: string; deliver?: string; profile?: string },
  ): Promise<void>;
  updateJob(
    rest: RestClient,
    jobId: string,
    params: { prompt?: string; schedule?: string; name?: string; deliver?: string; profile?: string },
  ): Promise<void>;
  deleteJob(rest: RestClient, jobId: string, profile?: string): Promise<void>;
  pauseJob(rest: RestClient, jobId: string, profile?: string): Promise<void>;
  resumeJob(rest: RestClient, jobId: string, profile?: string): Promise<void>;
  triggerJob(rest: RestClient, jobId: string, profile?: string): Promise<void>;
  loadJobRuns(rest: RestClient, jobId: string, profile?: string, limit?: number): Promise<CronJobRun[]>;
  clear(): void;
}

export const useCronStore = create<CronStore>((set, get) => ({
  jobs: [],
  deliveryTargets: [],
  selectedProfile: 'all',
  loading: false,
  actionLoading: null,
  error: undefined,

  setProfile(profile) {
    set({ selectedProfile: profile });
  },

  async loadJobs(rest) {
    set({ loading: true, error: undefined });
    try {
      const jobs = await rest.cronJobs(get().selectedProfile);
      set({ jobs, loading: false });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to load cron jobs';
      set({ loading: false, error: msg });
    }
  },

  async loadDeliveryTargets(rest) {
    try {
      const targets = await rest.cronDeliveryTargets();
      set({ deliveryTargets: targets });
    } catch {
      set({ deliveryTargets: [{ id: 'local', name: 'Local', homeTargetSet: true, homeEnvVar: null }] });
    }
  },

  async createJob(rest, { prompt, schedule, name, deliver, profile }) {
    const selected = profile ?? (get().selectedProfile === 'all' ? 'default' : get().selectedProfile);
    set({ actionLoading: 'create' });
    try {
      await rest.cronCreateJob(
        { prompt: prompt.trim(), schedule, name: name?.trim() || undefined, deliver },
        selected,
      );
      await get().loadJobs(rest);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to create job';
      set({ error: msg });
      throw err;
    } finally {
      set({ actionLoading: null });
    }
  },

  async updateJob(rest, jobId, { prompt, schedule, name, deliver, profile }) {
    const selected = profile ?? 'default';
    set({ actionLoading: `update:${jobId}` });
    try {
      const updates: { prompt?: string; schedule?: string; name?: string; deliver?: string } = {};
      if (prompt !== undefined) updates.prompt = prompt.trim();
      if (schedule !== undefined) updates.schedule = schedule;
      if (name !== undefined) updates.name = name.trim();
      if (deliver !== undefined) updates.deliver = deliver;
      await rest.cronUpdateJob(jobId, updates, selected);
      await get().loadJobs(rest);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to update job';
      set({ error: msg });
      throw err;
    } finally {
      set({ actionLoading: null });
    }
  },

  async deleteJob(rest, jobId, profile) {
    const selected = profile ?? 'default';
    set({ actionLoading: `delete:${jobId}` });
    try {
      await rest.cronDeleteJob(jobId, selected);
      await get().loadJobs(rest);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to delete job';
      set({ error: msg });
      throw err;
    } finally {
      set({ actionLoading: null });
    }
  },

  async pauseJob(rest, jobId, profile) {
    const selected = profile ?? 'default';
    set({ actionLoading: `pause:${jobId}` });
    try {
      await rest.cronPauseJob(jobId, selected);
      await get().loadJobs(rest);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to pause job';
      set({ error: msg });
      throw err;
    } finally {
      set({ actionLoading: null });
    }
  },

  async resumeJob(rest, jobId, profile) {
    const selected = profile ?? 'default';
    set({ actionLoading: `resume:${jobId}` });
    try {
      await rest.cronResumeJob(jobId, selected);
      await get().loadJobs(rest);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to resume job';
      set({ error: msg });
      throw err;
    } finally {
      set({ actionLoading: null });
    }
  },

  async triggerJob(rest, jobId, profile) {
    const selected = profile ?? 'default';
    set({ actionLoading: `trigger:${jobId}` });
    try {
      await rest.cronTriggerJob(jobId, selected);
      await get().loadJobs(rest);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to trigger job';
      set({ error: msg });
      throw err;
    } finally {
      set({ actionLoading: null });
    }
  },

  async loadJobRuns(rest, jobId, profile, limit = 20) {
    const selected = profile ?? 'default';
    try {
      const { runs } = await rest.cronJobRuns(jobId, selected, limit);
      return runs;
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to load runs';
      set({ error: msg });
      return [];
    }
  },

  clear() {
    set({
      jobs: [],
      deliveryTargets: [],
      selectedProfile: 'all',
      loading: false,
      actionLoading: null,
      error: undefined,
    });
  },
}));
