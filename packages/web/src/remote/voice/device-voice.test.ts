import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DeviceVoiceController, VOICE_LIMITS, type DeviceRecognition, type VoiceDevice } from './device-voice';

function deviceFixture() {
  const recognition: DeviceRecognition = { lang: '', continuous: false, interimResults: false, onresult: null, onerror: null, onend: null, start: vi.fn(), stop: vi.fn(), abort: vi.fn() };
  const completions: (() => void)[] = [];
  const device: VoiceDevice = { recognitionAvailable: true, playbackAvailable: true, createRecognition: vi.fn(() => recognition), speak: vi.fn((_text, done) => { completions.push(done); }), stopPlayback: vi.fn() };
  const controller = new DeviceVoiceController(device);
  controller.setScope('owner/profile/conversation-1');
  return { controller, device, recognition, completions };
}
function recognized(recognition: DeviceRecognition, text: string, final = true) {
  recognition.onresult?.({ resultIndex: 0, results: { length: 1, 0: { isFinal: final, 0: { transcript: text } } } });
}
describe('device voice memory-only coordination', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });
  it('does not request a microphone or playback until an explicit action', () => {
    const { device } = deviceFixture();
    expect(device.createRecognition).not.toHaveBeenCalled(); expect(device.speak).not.toHaveBeenCalled();
  });
  it('keeps Japanese recognition in a preview and returns it only to the same scope', () => {
    const { controller, recognition } = deviceFixture();
    controller.start(); recognized(recognition, 'こんにちは\n確認です。');
    expect(controller.insertion('owner/profile/conversation-1')).toBeNull();
    recognition.onend?.(); controller.edit('こんにちは\n修正しました。');
    expect(controller.insertion('another/session')).toBeNull();
    expect(controller.insertion('owner/profile/conversation-1')).toBe('こんにちは\n修正しました。');
    expect(recognition.lang).toBe('ja-JP');
  });
  it('retains an interim result on explicit stop with no device end callback', () => {
    const { controller, recognition } = deviceFixture(); controller.start(); recognized(recognition, '認識途中', false);
    controller.stop(); vi.advanceTimersByTime(5_000);
    expect(controller.snapshot()).toMatchObject({ phase: 'preview', text: '認識途中', interim: '' });
    expect(recognition.stop).toHaveBeenCalledTimes(1);
  });
  it('limits recognition to 60 seconds without restart', () => {
    const { controller, recognition, device } = deviceFixture(); controller.start(); controller.start();
    vi.advanceTimersByTime(VOICE_LIMITS.seconds * 1_000);
    expect(recognition.stop).toHaveBeenCalledTimes(1); expect(device.createRecognition).toHaveBeenCalledTimes(1);
    expect(controller.snapshot()).toMatchObject({ phase: 'finishing', elapsed: 60 });
    vi.advanceTimersByTime(10_000); expect(device.createRecognition).toHaveBeenCalledTimes(1);
  });
  it('bounds recognition text and ends recording rather than persisting excess', () => {
    const { controller, recognition } = deviceFixture(); controller.start(); recognized(recognition, 'あ'.repeat(80_000));
    expect(controller.snapshot().text).toHaveLength(8_000); expect(controller.snapshot().error).toContain('8,000');
    expect(recognition.stop).toHaveBeenCalledTimes(1);
  });
  it('clears text and rejects delayed callbacks after an auth/session change', () => {
    const { controller, recognition } = deviceFixture(); controller.start(); const stale = recognition.onresult;
    recognized(recognition, '旧会話'); controller.setScope('new-owner/new-profile/new-session');
    stale?.({ resultIndex: 0, results: { length: 1, 0: { isFinal: true, 0: { transcript: '遅延' } } } });
    expect(controller.snapshot()).toMatchObject({ phase: 'idle', text: '', interim: '' }); expect(recognition.abort).toHaveBeenCalled();
  });
  it('reports permission failure without retry or retaining an active microphone', () => {
    const { controller, recognition, device } = deviceFixture(); controller.start(); recognition.onerror?.({ error: 'not-allowed' });
    vi.advanceTimersByTime(80_000); expect(device.createRecognition).toHaveBeenCalledTimes(1); expect(recognition.abort).toHaveBeenCalled();
    expect(controller.snapshot()).toMatchObject({ phase: 'error', elapsed: 0 }); expect(controller.snapshot().error).toContain('許可');
  });
  it('reports an unavailable or throwing device while preserving ordinary input', () => {
    const { controller, device } = deviceFixture(); device.recognitionAvailable = false; controller.start();
    expect(device.createRecognition).not.toHaveBeenCalled();
    device.recognitionAvailable = true; vi.mocked(device.createRecognition).mockImplementation(() => { throw new Error('device'); });
    expect(() => controller.start()).not.toThrow(); expect(controller.snapshot().phase).toBe('error');
  });
  it('does not let an old TTS completion stop a newer read', () => {
    const { controller, device, completions } = deviceFixture(); controller.read('最初'); controller.read('次');
    completions[0]!(); expect(controller.snapshot().reading).toBe(true);
    completions[1]!(); expect(controller.snapshot().reading).toBe(false); expect(device.speak).toHaveBeenCalledTimes(2);
  });
  it('bounds TTS and stops it when scope ends or the controller is disposed', () => {
    const { controller, device } = deviceFixture(); controller.read('あ'.repeat(8_001)); expect(device.speak).not.toHaveBeenCalled();
    controller.read('合成の文章'); controller.dispose(); expect(controller.snapshot().reading).toBe(false); expect(device.stopPlayback).toHaveBeenCalled();
  });
});
