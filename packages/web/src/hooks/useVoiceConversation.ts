import { useCallback, useEffect, useRef, useState } from 'react';
import type { Message } from '@hermes-pwa/core';
import { useMicRecorder } from './useMicRecorder';

export type ConversationStatus = 'idle' | 'listening' | 'transcribing' | 'thinking' | 'speaking';

export interface VoiceConversationOptions {
  enabled: boolean;
  busy: boolean;
  messages: Message[];
  onSubmit: (text: string) => void;
  onTranscribeAudio?: ((audio: Blob) => Promise<string>) | undefined;
  onSpeakText?: ((text: string) => Promise<void>) | undefined;
  onStopSpeech?: (() => void) | undefined;
  onPrimeAudio?: (() => void) | undefined;
}

export function useVoiceConversation({
  enabled,
  busy,
  messages,
  onSubmit,
  onTranscribeAudio,
  onSpeakText,
  onStopSpeech,
  onPrimeAudio,
}: VoiceConversationOptions) {
  const { handle, level } = useMicRecorder();
  const [status, setStatus] = useState<ConversationStatus>('idle');
  const [muted, setMuted] = useState(false);
  const turnClosingRef = useRef(false);
  const enabledRef = useRef(enabled);
  const mutedRef = useRef(muted);
  const busyRef = useRef(busy);
  const statusRef = useRef<ConversationStatus>('idle');
  const messagesRef = useRef(messages);
  const pendingTurnRef = useRef<{ assistantIdsBefore: Set<string> } | null>(null);
  const spokenRef = useRef(false);

  useEffect(() => {
    enabledRef.current = enabled;
  }, [enabled]);
  useEffect(() => {
    mutedRef.current = muted;
  }, [muted]);
  useEffect(() => {
    busyRef.current = busy;
  }, [busy]);
  useEffect(() => {
    statusRef.current = status;
  }, [status]);
  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  const handleTurn = useCallback(
    async (forceTranscribe = false) => {
      if (turnClosingRef.current) return;
      turnClosingRef.current = true;
      setStatus('transcribing');
      try {
        const result = await handle.stop();
        if (!result || (!result.heardSpeech && !forceTranscribe) || !onTranscribeAudio) {
          setStatus('idle');
          return;
        }
        try {
          const transcript = (await onTranscribeAudio(result.audio)).trim();
          if (!transcript) {
            setStatus('idle');
            return;
          }
          pendingTurnRef.current = {
            assistantIdsBefore: new Set(
              messagesRef.current.filter((message) => message.role === 'assistant').map((message) => message.id),
            ),
          };
          onSubmit(transcript);
          setStatus('thinking');
        } catch {
          setStatus('idle');
        }
      } finally {
        turnClosingRef.current = false;
      }
    },
    [handle, onSubmit, onTranscribeAudio],
  );

  const startListening = useCallback(async () => {
    if (!enabledRef.current || mutedRef.current || busyRef.current) return;
    if (statusRef.current !== 'idle') return;
    if (!onTranscribeAudio) return;
    try {
      await handle.start({
        silenceLevel: 0.035,
        silenceMs: 1000,
        idleSilenceMs: 12000,
        onError: () => setStatus('idle'),
        onSilence: () => void handleTurn(),
      });
      if (!enabledRef.current || mutedRef.current || busyRef.current || statusRef.current !== 'idle') {
        handle.cancel();
        setStatus('idle');
        return;
      }
      setStatus('listening');
    } catch {
      setStatus('idle');
    }
  }, [handle, handleTurn, onTranscribeAudio]);

  const end = useCallback(() => {
    pendingTurnRef.current = null;
    handle.cancel();
    onStopSpeech?.();
    turnClosingRef.current = false;
    spokenRef.current = false;
    setMuted(false);
    setStatus('idle');
  }, [handle, onStopSpeech]);

  const start = useCallback(() => {
    if (!onTranscribeAudio) {
      end();
      return;
    }
    onPrimeAudio?.();
    setMuted(false);
    spokenRef.current = false;
    setStatus('idle');
    void startListening();
  }, [end, onPrimeAudio, onTranscribeAudio, startListening]);

  const toggle = useCallback(() => {
    if (enabled) {
      end();
    } else {
      start();
    }
  }, [enabled, end, start]);

  const toggleMute = useCallback(() => {
    setMuted((value) => {
      const next = !value;
      if (next) {
        handle.cancel();
        onStopSpeech?.();
        setStatus('idle');
      }
      return next;
    });
  }, [handle, onStopSpeech]);

  const stopTurn = useCallback(() => {
    if (statusRef.current === 'listening') {
      void handleTurn(true);
    }
  }, [handleTurn]);

  useEffect(() => {
    if (!enabled) {
      end();
      return;
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.code !== 'Space' || event.repeat || event.metaKey || event.ctrlKey || event.altKey) return;
      if (statusRef.current !== 'listening') return;
      event.preventDefault();
      stopTurn();
    };
    window.addEventListener('keydown', onKeyDown, { capture: true });
    return () => window.removeEventListener('keydown', onKeyDown, { capture: true });
  }, [enabled, end, stopTurn]);

  useEffect(() => {
    if (!enabled || muted) return;
    if (status !== 'thinking' || busy) return;

    const pending = pendingTurnRef.current;
    if (!pending) {
      setStatus('idle');
      return;
    }

    const assistantReply = [...messages]
      .reverse()
      .find(
        (message) =>
          message.role === 'assistant' &&
          !pending.assistantIdsBefore.has(message.id) &&
          Boolean(message.text.trim()),
      );
    const text = assistantReply?.text.trim();
    if (!text) return;

    pendingTurnRef.current = null;
    spokenRef.current = false;
    setStatus('speaking');
    void (async () => {
      try {
        spokenRef.current = true;
        if (onSpeakText) {
          await onSpeakText(text);
        }
      } finally {
        spokenRef.current = false;
        setStatus('idle');
      }
    })();
  }, [enabled, muted, status, busy, messages, onSpeakText]);

  useEffect(() => {
    if (!enabled || muted || busy || status !== 'idle') return;
    void startListening();
  }, [enabled, muted, busy, status, startListening]);

  return { active: enabled, toggle, status, muted, toggleMute, level, stopTurn };
}
