export const VOICE_LIMITS = { seconds: 60, characters: 8_000 } as const;
export interface RecognitionResult { isFinal: boolean; 0: { transcript: string } }
export interface RecognitionEvent { resultIndex: number; results: { length: number; [index: number]: RecognitionResult } }
export interface DeviceRecognition {
  lang: string; continuous: boolean; interimResults: boolean;
  onresult: ((event: RecognitionEvent) => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  onend: (() => void) | null;
  start(): void; stop(): void; abort(): void;
}
export interface VoiceDevice {
  recognitionAvailable: boolean; playbackAvailable: boolean;
  createRecognition(): DeviceRecognition;
  speak(text: string, done: () => void, failed: () => void): void;
  stopPlayback(): void;
}
export interface VoiceSnapshot {
  phase: 'idle' | 'listening' | 'finishing' | 'preview' | 'error';
  text: string; interim: string; elapsed: number; error: string; reading: boolean;
}

/** Only device recognition/synthesis; no server mic, provider resolver or raw audio file. */
export class DeviceVoiceController {
  private state: VoiceSnapshot = { phase: 'idle', text: '', interim: '', elapsed: 0, error: '', reading: false };
  private listeners = new Set<() => void>();
  private recognition: DeviceRecognition | null = null;
  private scope = ''; private generation = 0; private playbackGeneration = 0;
  private timer: ReturnType<typeof setInterval> | null = null;
  private ending: ReturnType<typeof setTimeout> | null = null;
  constructor(readonly device: VoiceDevice = browserVoiceDevice()) {}
  snapshot = (): VoiceSnapshot => this.state;
  subscribe = (listener: () => void): (() => void) => { this.listeners.add(listener); return () => this.listeners.delete(listener); };
  setScope(scope: string): void { if (scope !== this.scope) { this.reset(); this.scope = scope; } }
  start(): void {
    if (!this.scope || !this.device.recognitionAvailable || ['listening', 'finishing'].includes(this.state.phase)) return;
    this.stopPlayback(); this.cancelRecognition(); const generation = ++this.generation;
    let recognition: DeviceRecognition;
    try { recognition = this.device.createRecognition(); }
    catch { this.patch({ phase: 'error', error: '端末の音声認識を開始できません。本文入力はそのまま使えます。' }); return; }
    this.recognition = recognition;
    recognition.lang = 'ja-JP'; recognition.continuous = true; recognition.interimResults = true;
    const completed = new Map<number, string>();
    recognition.onresult = event => {
      if (generation !== this.generation) return;
      let interim = '';
      for (let index = event.resultIndex; index < Math.min(event.results.length, 500); index += 1) {
        const result = event.results[index]; if (!result) continue;
        const text = (result[0]?.transcript || '').slice(0, VOICE_LIMITS.characters + 1);
        if (result.isFinal) completed.set(index, text); else interim = (interim + text).slice(0, VOICE_LIMITS.characters + 1);
      }
      const text = [...completed.entries()].sort((left, right) => left[0] - right[0]).reduce((combined, [, value]) => (combined + value).slice(0, VOICE_LIMITS.characters + 1), '');
      const limited = text.length + interim.length > VOICE_LIMITS.characters;
      this.patch({ text: text.slice(0, VOICE_LIMITS.characters), interim: interim.slice(0, Math.max(0, VOICE_LIMITS.characters - text.length)), error: limited ? '認識結果は8,000文字で打ち切りました。内容を確認してください。' : '' });
      if (limited) this.stop();
    };
    recognition.onerror = event => {
      if (generation !== this.generation) return;
      this.generation += 1; this.clearTimers(); this.patch({ phase: 'error', error: recognitionError(event.error), interim: '' });
      this.cancelRecognition();
    };
    recognition.onend = () => {
      if (generation !== this.generation) return;
      this.generation += 1; this.clearTimers(); this.recognition = null;
      this.patch({ phase: this.state.text || this.state.interim ? 'preview' : 'idle', text: (this.state.text + this.state.interim).slice(0, VOICE_LIMITS.characters), interim: '' });
    };
    this.patch({ phase: 'listening', text: '', interim: '', elapsed: 0, error: '' });
    try { recognition.start(); }
    catch { this.cancelRecognition(); this.patch({ phase: 'error', error: '端末の音声認識を開始できません。本文入力はそのまま使えます。' }); return; }
    if (generation !== this.generation || this.snapshot().phase !== 'listening') return;
    this.timer = setInterval(() => {
      if (generation !== this.generation) return;
      this.patch({ elapsed: this.state.elapsed + 1 });
      if (this.state.elapsed >= VOICE_LIMITS.seconds) this.stop();
    }, 1_000);
  }
  stop(): void {
    if (!this.recognition || this.state.phase !== 'listening') return;
    if (this.timer) clearInterval(this.timer); this.timer = null;
    this.patch({ phase: 'finishing' });
    try { this.recognition.stop(); } catch { this.finishWithoutCallback(); return; }
    if (this.snapshot().phase === 'finishing') this.ending = setTimeout(() => this.finishWithoutCallback(), 5_000);
  }
  edit(text: string): void { if (!['listening', 'finishing'].includes(this.state.phase)) this.patch({ text: text.slice(0, VOICE_LIMITS.characters), phase: 'preview' }); }
  /** Explicit insertion returns plain text; the caller uses the existing draft insertion helper. */
  insertion(scope: string): string | null {
    if (scope !== this.scope || this.state.phase !== 'preview' || !this.state.text.trim()) return null;
    return this.state.text;
  }
  read(text: string): void {
    if (!this.scope || !this.device.playbackAvailable || ['listening', 'finishing'].includes(this.state.phase)) return;
    this.stopPlayback(); const generation = this.generation; const playback = this.playbackGeneration;
    if (!text.trim()) return;
    if (text.length > VOICE_LIMITS.characters) { this.patch({ error: '読み上げは8,000文字以内の範囲を選んでください。' }); return; }
    this.patch({ reading: true, error: '' });
    try { this.device.speak(text, () => { if (generation === this.generation && playback === this.playbackGeneration) this.patch({ reading: false }); }, () => { if (generation === this.generation && playback === this.playbackGeneration) this.patch({ reading: false, error: '端末の読み上げを完了できません。' }); }); }
    catch { this.patch({ reading: false, error: 'この端末では読み上げを開始できません。' }); }
  }
  stopPlayback(): void { this.playbackGeneration += 1; try { this.device.stopPlayback(); } catch { /* Device teardown can fail after navigation. */ } if (this.state.reading) this.patch({ reading: false }); }
  reset(): void {
    this.generation += 1; this.cancelRecognition(); this.stopPlayback();
    this.patch({ phase: 'idle', text: '', interim: '', elapsed: 0, error: '', reading: false });
  }
  dispose(): void { this.reset(); this.listeners.clear(); }
  private finishWithoutCallback(): void {
    const text = (this.state.text + this.state.interim).slice(0, VOICE_LIMITS.characters);
    this.generation += 1; this.cancelRecognition(); this.patch({ phase: text ? 'preview' : 'idle', text, interim: '' });
  }
  private cancelRecognition(): void {
    this.clearTimers(); const recognition = this.recognition; this.recognition = null;
    if (recognition) { recognition.onresult = null; recognition.onerror = null; recognition.onend = null; try { recognition.abort(); } catch { /* The device may have already stopped. */ } }
  }
  private clearTimers(): void { if (this.timer) clearInterval(this.timer); if (this.ending) clearTimeout(this.ending); this.timer = null; this.ending = null; }
  private patch(values: Partial<VoiceSnapshot>): void { this.state = { ...this.state, ...values }; for (const listener of this.listeners) listener(); }
}
function recognitionError(code: string): string {
  return code === 'not-allowed' || code === 'service-not-allowed' ? 'マイク・音声認識の許可を確認してください。自動で再要求しません。'
    : code === 'audio-capture' ? '端末のマイクを利用できません。' : code === 'network' ? '端末の音声認識サービスへ接続できません。自動再試行はしません。'
      : code === 'no-speech' ? '音声を認識できませんでした。必要なら明示操作で開始してください。' : '音声認識が終了しました。認識済みの文章を確認してください。';
}
export function browserVoiceDevice(): VoiceDevice {
  const browser = window as unknown as { SpeechRecognition?: new () => DeviceRecognition; webkitSpeechRecognition?: new () => DeviceRecognition };
  const Recognition = browser.SpeechRecognition || browser.webkitSpeechRecognition;
  return {
    recognitionAvailable: !!Recognition, playbackAvailable: !!window.speechSynthesis && typeof SpeechSynthesisUtterance !== 'undefined',
    createRecognition: () => { if (!Recognition) throw new Error('unsupported'); return new Recognition(); },
    speak: (text, done, failed) => {
      const utterance = new SpeechSynthesisUtterance(text); utterance.lang = 'ja-JP'; utterance.onend = done; utterance.onerror = failed;
      window.speechSynthesis.speak(utterance);
    },
    stopPlayback: () => window.speechSynthesis?.cancel(),
  };
}
