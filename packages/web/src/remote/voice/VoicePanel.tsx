import { useEffect, useState, useSyncExternalStore } from 'react';
import { ConfirmDialog } from '../ConfirmDialog';
import { DeviceVoiceController } from './device-voice';
import './voice.css';

export function VoicePanel({ controller, scope, composing, onInsert, onDismiss }: {
  controller: DeviceVoiceController; scope: string; composing: boolean;
  onInsert(text: string, scope: string): void; onDismiss(): void;
}) {
  const state = useSyncExternalStore(controller.subscribe, controller.snapshot);
  const [previewComposing, setPreviewComposing] = useState(false);
  const imeActive = composing || previewComposing;
  useEffect(() => { controller.setScope(scope); return () => controller.reset(); }, [controller, scope]);
  return <ConfirmDialog label="音声入力" className="remote-voice-panel" onDismiss={() => { if (!imeActive) { controller.reset(); onDismiss(); } }}>
    <div className="remote-sheet-heading"><h2>音声入力</h2><button data-dialog-initial-focus="" disabled={imeActive} onClick={() => { controller.reset(); onDismiss(); }}>閉じる</button></div>
    <div className="remote-voice-scroll" role="region" aria-label="音声入力の内容" tabIndex={0}>
    <p className="remote-meta">端末・ブラウザの音声認識を使います。音声がブラウザ提供元の認識サービスへ送られる場合があります。Hermesへ送るのは、確認して入力欄へ戻した文章を明示送信したときだけです。</p>
    {!controller.device.recognitionAvailable ? <p role="status">このブラウザはアプリ内の音声認識に未対応です。通常の本文入力は利用できます。</p> : <>
      <div className="remote-actions"><button disabled={imeActive || ['listening', 'finishing'].includes(state.phase)} onClick={() => controller.start()}>音声認識を開始</button>
        <button disabled={state.phase !== 'listening'} onClick={() => controller.stop()}>録音を停止</button></div>
      <p role="status">{state.phase === 'listening' ? `認識中 · ${state.elapsed}秒 / 最大60秒` : state.phase === 'finishing' ? '録音停止・認識結果を確認中' : '文章を確認してから入力欄へ戻してください。'}</p>
      {state.interim && <p className="remote-voice-interim">認識途中: {state.interim}</p>}
      <label htmlFor="remote-voice-preview">認識結果を編集<textarea id="remote-voice-preview" disabled={composing || ['listening', 'finishing'].includes(state.phase)} value={state.text} maxLength={8_000} onCompositionStart={() => setPreviewComposing(true)} onCompositionEnd={() => setPreviewComposing(false)} onChange={event => controller.edit(event.target.value)} /></label>
      <p className="remote-meta">{Array.from(state.text).length.toLocaleString('ja-JP')}文字 / 上限8,000文字。音声ファイルは作成・保存しません。音声bytesが提供されない端末APIなので、ファイル容量ではなく60秒で制限します。</p>
      <button disabled={imeActive || state.phase !== 'preview' || !state.text.trim()} onClick={() => { const text = controller.insertion(scope); if (text !== null) { onInsert(text, scope); controller.reset(); onDismiss(); } }}>文章を入力欄へ挿入</button>
    </>}
    {state.error && <p role="alert">{state.error}</p>}
    </div>
  </ConfirmDialog>;
}

/** Explicit per-message TTS control; caller passes only the selected visible body. */
export function ReadAloud({ controller, scope, text }: { controller: DeviceVoiceController; scope: string; text: string }) {
  const state = useSyncExternalStore(controller.subscribe, controller.snapshot);
  return <div className="remote-actions"><button disabled={!controller.device.playbackAvailable || !text.trim() || ['listening', 'finishing'].includes(state.phase)} onClick={() => { controller.setScope(scope); controller.read(text); }}>端末で読み上げ</button>
    <button disabled={!state.reading} onClick={() => controller.stopPlayback()}>読み上げを停止</button>
    {state.error && <p role="status">{state.error}</p>}
    {!controller.device.playbackAvailable && <p className="remote-meta">この端末では読み上げ未対応です。</p>}</div>;
}
