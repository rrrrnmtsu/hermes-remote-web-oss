import { NativeShellClient, type NativeChannel, type NativeSharedDraft } from '../../../core/src/features/native-shell';

interface NativeWindow extends Window { webkit?: { messageHandlers?: { hermesRemote?: NativeChannel } } }

/** Safari has no bridge. Native frame origin is independently checked by WKWebView on every operation. */
export function nativeShellClient(target: Window = window): NativeShellClient | null {
  if (target.top !== target || target.location.protocol !== 'https:') return null;
  const channel = (target as NativeWindow).webkit?.messageHandlers?.hermesRemote;
  if (!channel || typeof channel.postMessage !== 'function') return null;
  try { return new NativeShellClient(target.location.origin, channel); } catch { return null; }
}
export function bindNativeResume(onReadOnlyRecover: () => Promise<void>, target: Window = window): () => void {
  let recovering = false; let active = true;
  const resume = (): void => {
    if (recovering || !active || !nativeShellClient(target)) return;
    recovering = true;
    void onReadOnlyRecover().catch(() => undefined).finally(() => { recovering = false; });
  };
  target.addEventListener('hermes-native-resume', resume);
  return () => { active = false; target.removeEventListener('hermes-native-resume', resume); };
}

/** Explicit confirmed import only. The shared composer/controller applies these memory-only values. */
export function sharedDraftFile(draft: NativeSharedDraft): File | null {
  if (draft.kind !== 'file') return null;
  const binary = atob(draft.contentBase64); const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return new File([bytes], draft.name, { type: draft.mime });
}
