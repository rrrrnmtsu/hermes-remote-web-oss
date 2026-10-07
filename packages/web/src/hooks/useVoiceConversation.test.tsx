import { act, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Message } from '@hermes-pwa/core';
import { useVoiceConversation } from './useVoiceConversation';

const mocks = vi.hoisted(() => {
  let micOptions: {
    onSilence?: () => void;
    onError?: (error: Error) => void;
  } | undefined;
  return {
    getMicOptions: () => micOptions,
    setMicOptions: (options: typeof micOptions) => {
      micOptions = options;
    },
    start: vi.fn(async (options?: typeof micOptions) => {
      micOptions = options;
    }),
    stop: vi.fn(async () => ({
      audio: new Blob(['voice'], { type: 'audio/webm' }),
      durationMs: 1200,
      heardSpeech: true,
    })),
    cancel: vi.fn(),
    speakText: vi.fn(async () => undefined),
    stopSpeech: vi.fn(),
    primeAudio: vi.fn(),
  };
});

vi.mock('./useMicRecorder', () => ({
  useMicRecorder: () => ({
    handle: {
      start: mocks.start,
      stop: mocks.stop,
      cancel: mocks.cancel,
    },
    level: 0.4,
    recording: false,
  }),
}));

function Harness({
  enabled = true,
  busy = false,
  messages = [],
  onSubmit = vi.fn(),
  onTranscribeAudio = vi.fn(async () => 'hello from voice'),
  onSpeakText = mocks.speakText,
}: {
  enabled?: boolean;
  busy?: boolean;
  messages?: Message[];
  onSubmit?: (text: string) => void;
  onTranscribeAudio?: (audio: Blob) => Promise<string>;
  onSpeakText?: (text: string) => Promise<void>;
}) {
  const voice = useVoiceConversation({
    enabled,
    busy,
    messages,
    onSubmit,
    onTranscribeAudio,
    onSpeakText,
    onStopSpeech: mocks.stopSpeech,
    onPrimeAudio: mocks.primeAudio,
  });
  return <div data-testid="voice-status">{voice.status}</div>;
}

describe('useVoiceConversation', () => {
  beforeEach(() => {
    mocks.start.mockClear();
    mocks.stop.mockClear();
    mocks.cancel.mockClear();
    mocks.speakText.mockClear();
    mocks.stopSpeech.mockClear();
    mocks.primeAudio.mockClear();
    mocks.setMicOptions(undefined);
  });

  it('keeps wave live chat in thinking until the completed assistant reply is ready, then speaks and listens again', async () => {
    const onSubmit = vi.fn();
    let finishSpeak: (() => void) | undefined;
    const onSpeakText = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finishSpeak = resolve;
        }),
    );
    const { rerender } = render(
      <Harness enabled busy={false} messages={[]} onSubmit={onSubmit} onSpeakText={onSpeakText} />,
    );

    await waitFor(() => expect(screen.getByTestId('voice-status')).toHaveTextContent('listening'));
    await waitFor(() => expect(mocks.getMicOptions()?.onSilence).toBeTypeOf('function'));

    await act(async () => {
      mocks.getMicOptions()?.onSilence?.();
    });

    await waitFor(() => expect(onSubmit).toHaveBeenCalledWith('hello from voice'));
    expect(screen.getByTestId('voice-status')).toHaveTextContent('thinking');

    rerender(<Harness enabled busy={false} messages={[]} onSubmit={onSubmit} onSpeakText={onSpeakText} />);
    expect(screen.getByTestId('voice-status')).toHaveTextContent('thinking');
    expect(onSpeakText).not.toHaveBeenCalled();

    const messages: Message[] = [
      { id: 'u-1', role: 'user', text: 'hello from voice', createdAt: undefined },
      { id: 'a-1', role: 'assistant', text: 'Spoken answer', createdAt: undefined },
    ];
    rerender(<Harness enabled busy={false} messages={messages} onSubmit={onSubmit} onSpeakText={onSpeakText} />);

    await waitFor(() => expect(onSpeakText).toHaveBeenCalledWith('Spoken answer'));
    expect(screen.getByTestId('voice-status')).toHaveTextContent('speaking');

    act(() => {
      finishSpeak?.();
    });

    await waitFor(() => expect(screen.getByTestId('voice-status')).toHaveTextContent('listening'));
    expect(mocks.start).toHaveBeenCalledTimes(2);
  });

  it('cancels the microphone if wave is disabled while browser mic startup is still resolving', async () => {
    let resolveStart: (() => void) | undefined;
    mocks.start.mockImplementationOnce(
      async (options?: Parameters<typeof mocks.setMicOptions>[0]) => {
        mocks.setMicOptions(options);
        await new Promise<void>((resolve) => {
          resolveStart = resolve;
        });
      },
    );

    const { rerender } = render(<Harness enabled busy={false} messages={[]} />);
    await waitFor(() => expect(mocks.start).toHaveBeenCalledTimes(1));

    rerender(<Harness enabled={false} busy={false} messages={[]} />);
    act(() => {
      resolveStart?.();
    });

    await waitFor(() => expect(mocks.cancel).toHaveBeenCalled());
    expect(screen.getByTestId('voice-status')).toHaveTextContent('idle');
  });

  it('does not speak an assistant message that existed before the wave turn started', async () => {
    const onSubmit = vi.fn();
    const existingMessages: Message[] = [
      { id: 'a-old', role: 'assistant', text: 'Old answer', createdAt: undefined },
    ];
    const { rerender } = render(<Harness enabled busy={false} messages={existingMessages} onSubmit={onSubmit} />);

    await waitFor(() => expect(screen.getByTestId('voice-status')).toHaveTextContent('listening'));

    await act(async () => {
      mocks.getMicOptions()?.onSilence?.();
    });

    await waitFor(() => expect(onSubmit).toHaveBeenCalledWith('hello from voice'));
    rerender(<Harness enabled busy={false} messages={existingMessages} onSubmit={onSubmit} />);

    expect(screen.getByTestId('voice-status')).toHaveTextContent('thinking');
    expect(mocks.speakText).not.toHaveBeenCalled();
  });
});
