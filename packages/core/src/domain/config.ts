/**
 * Narrow view of the Hermes Agent config for the mobile PWA Settings screen.
 * Only the groups that make sense to edit from a phone are typed here.
 */

export interface HermesConfigModel {
  default?: string;
  provider?: string;
}

export interface HermesConfigPlatform {
  enabled?: boolean;
}

export interface HermesConfigApprovals {
  mode?: string;
  timeout?: number;
}

export interface HermesConfigDisplay {
  skin?: string;
  language?: string;
  compact?: boolean;
  bell_on_complete?: boolean;
  timestamps?: boolean;
  show_cost?: boolean;
  long_running_notifications?: boolean;
  busy_ack_detail?: boolean;
  busy_input_mode?: 'queue' | 'steer' | 'interrupt';
}

export interface HermesConfigTtsProvider {
  voice?: string;
  voice_id?: string;
  model?: string;
  ref_audio?: string;
  ref_text?: string;
  device?: string;
}

export interface HermesConfigTts {
  provider?: string;
  edge?: HermesConfigTtsProvider;
  elevenlabs?: HermesConfigTtsProvider;
  openai?: HermesConfigTtsProvider;
  gemini?: HermesConfigTtsProvider;
  xai?: HermesConfigTtsProvider;
  mistral?: HermesConfigTtsProvider;
  neutts?: HermesConfigTtsProvider;
  piper?: HermesConfigTtsProvider;
}

export interface HermesConfigSttProvider {
  model?: string;
  language?: string;
  language_code?: string;
  tag_audio_events?: boolean;
  diarize?: boolean;
}

export interface HermesConfigStt {
  enabled?: boolean;
  provider?: string;
  local?: HermesConfigSttProvider;
  openai?: HermesConfigSttProvider;
  mistral?: HermesConfigSttProvider;
  elevenlabs?: HermesConfigSttProvider;
}

export interface HermesConfigVoice {
  auto_tts?: boolean;
  max_recording_seconds?: number;
}

export interface HermesConfigMemory {
  memory_enabled?: boolean;
  user_profile_enabled?: boolean;
  write_approval?: boolean;
}

export interface HermesConfigSecurity {
  allow_private_urls?: boolean;
}

export interface HermesConfigPrivacy {
  redact_pii?: boolean;
}

export interface HermesConfig {
  model?: HermesConfigModel;
  platforms?: Record<string, HermesConfigPlatform | undefined>;
  approvals?: HermesConfigApprovals;
  display?: HermesConfigDisplay;
  tts?: HermesConfigTts;
  stt?: HermesConfigStt;
  voice?: HermesConfigVoice;
  memory?: HermesConfigMemory;
  security?: HermesConfigSecurity;
  privacy?: HermesConfigPrivacy;
}

export function toHermesConfig(raw: Record<string, unknown>): HermesConfig {
  const config: HermesConfig = {};
  if (raw.model !== undefined && typeof raw.model === 'object') {
    const m = raw.model as Record<string, unknown>;
    config.model = {
      ...(m.default !== undefined ? { default: String(m.default) } : {}),
      ...(m.provider !== undefined ? { provider: String(m.provider) } : {}),
    };
  }
  if (raw.platforms !== undefined && typeof raw.platforms === 'object') {
    const p = raw.platforms as Record<string, unknown>;
    const platforms: Record<string, HermesConfigPlatform> = {};
    for (const [key, value] of Object.entries(p)) {
      if (value !== undefined && typeof value === 'object') {
        const entry = value as Record<string, unknown>;
        platforms[key] = {
          ...(entry.enabled === true || entry.enabled === false ? { enabled: Boolean(entry.enabled) } : {}),
        };
      }
    }
    if (Object.keys(platforms).length > 0) config.platforms = platforms;
  }
  if (raw.approvals !== undefined && typeof raw.approvals === 'object') {
    const a = raw.approvals as Record<string, unknown>;
    config.approvals = {
      ...(typeof a.mode === 'string' ? { mode: a.mode } : {}),
      ...(typeof a.timeout === 'number' ? { timeout: a.timeout } : {}),
    };
  }
  if (raw.display !== undefined && typeof raw.display === 'object') {
    const d = raw.display as Record<string, unknown>;
    config.display = {
      ...(typeof d.skin === 'string' ? { skin: d.skin } : {}),
      ...(typeof d.language === 'string' ? { language: d.language } : {}),
      ...(d.compact === true || d.compact === false ? { compact: Boolean(d.compact) } : {}),
      ...(d.bell_on_complete === true || d.bell_on_complete === false ? { bell_on_complete: Boolean(d.bell_on_complete) } : {}),
      ...(d.timestamps === true || d.timestamps === false ? { timestamps: Boolean(d.timestamps) } : {}),
      ...(d.show_cost === true || d.show_cost === false ? { show_cost: Boolean(d.show_cost) } : {}),
      ...(d.long_running_notifications === true || d.long_running_notifications === false
        ? { long_running_notifications: Boolean(d.long_running_notifications) }
        : {}),
      ...(d.busy_ack_detail === true || d.busy_ack_detail === false ? { busy_ack_detail: Boolean(d.busy_ack_detail) } : {}),
      ...(d.busy_input_mode === 'queue' || d.busy_input_mode === 'steer' || d.busy_input_mode === 'interrupt'
        ? { busy_input_mode: d.busy_input_mode }
        : {}),
    };
  }
  if (raw.tts !== undefined && typeof raw.tts === 'object') {
    config.tts = extractTts(raw.tts as Record<string, unknown>);
  }
  if (raw.stt !== undefined && typeof raw.stt === 'object') {
    config.stt = extractStt(raw.stt as Record<string, unknown>);
  }
  if (raw.voice !== undefined && typeof raw.voice === 'object') {
    const v = raw.voice as Record<string, unknown>;
    config.voice = {
      ...(v.auto_tts === true || v.auto_tts === false ? { auto_tts: Boolean(v.auto_tts) } : {}),
      ...(typeof v.max_recording_seconds === 'number' ? { max_recording_seconds: v.max_recording_seconds } : {}),
    };
  }
  if (raw.memory !== undefined && typeof raw.memory === 'object') {
    const m = raw.memory as Record<string, unknown>;
    config.memory = {
      ...(m.memory_enabled === true || m.memory_enabled === false ? { memory_enabled: Boolean(m.memory_enabled) } : {}),
      ...(m.user_profile_enabled === true || m.user_profile_enabled === false
        ? { user_profile_enabled: Boolean(m.user_profile_enabled) }
        : {}),
      ...(m.write_approval === true || m.write_approval === false ? { write_approval: Boolean(m.write_approval) } : {}),
    };
  }
  if (raw.security !== undefined && typeof raw.security === 'object') {
    const s = raw.security as Record<string, unknown>;
    config.security = {
      ...(s.allow_private_urls === true || s.allow_private_urls === false
        ? { allow_private_urls: Boolean(s.allow_private_urls) }
        : {}),
    };
  }
  if (raw.privacy !== undefined && typeof raw.privacy === 'object') {
    const p = raw.privacy as Record<string, unknown>;
    config.privacy = {
      ...(p.redact_pii === true || p.redact_pii === false ? { redact_pii: Boolean(p.redact_pii) } : {}),
    };
  }
  return config;
}

function extractTts(raw: Record<string, unknown>): HermesConfigTts {
  const tts: HermesConfigTts = {};
  if (typeof raw.provider === 'string') tts.provider = raw.provider;
  const providers = ['edge', 'elevenlabs', 'openai', 'gemini', 'xai', 'mistral', 'neutts', 'piper'] as const;
  for (const key of providers) {
    const value = raw[key];
    if (value !== undefined && typeof value === 'object') {
      const p = value as Record<string, unknown>;
      const provider: HermesConfigTtsProvider = {};
      if (typeof p.voice === 'string') provider.voice = p.voice;
      if (typeof p.voice_id === 'string') provider.voice_id = p.voice_id;
      if (typeof p.model === 'string') provider.model = p.model;
      if (typeof p.ref_audio === 'string') provider.ref_audio = p.ref_audio;
      if (typeof p.ref_text === 'string') provider.ref_text = p.ref_text;
      if (typeof p.device === 'string') provider.device = p.device;
      if (Object.keys(provider).length > 0) {
        (tts as Record<string, HermesConfigTtsProvider | undefined>)[key] = provider;
      }
    }
  }
  return tts;
}

function extractStt(raw: Record<string, unknown>): HermesConfigStt {
  const stt: HermesConfigStt = {};
  if (raw.enabled === true || raw.enabled === false) stt.enabled = Boolean(raw.enabled);
  if (typeof raw.provider === 'string') stt.provider = raw.provider;
  const providers = ['local', 'openai', 'mistral', 'elevenlabs'] as const;
  for (const key of providers) {
    const value = raw[key];
    if (value !== undefined && typeof value === 'object') {
      const p = value as Record<string, unknown>;
      const provider: HermesConfigSttProvider = {};
      if (typeof p.model === 'string') provider.model = p.model;
      if (typeof p.language === 'string') provider.language = p.language;
      if (typeof p.language_code === 'string') provider.language_code = p.language_code;
      if (p.tag_audio_events === true || p.tag_audio_events === false) provider.tag_audio_events = Boolean(p.tag_audio_events);
      if (p.diarize === true || p.diarize === false) provider.diarize = Boolean(p.diarize);
      if (Object.keys(provider).length > 0) {
        (stt as Record<string, HermesConfigSttProvider | undefined>)[key] = provider;
      }
    }
  }
  return stt;
}
