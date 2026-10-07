import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Composer } from './Composer';

const mocks = vi.hoisted(() => ({
  voiceRecorder: {
    dictate: vi.fn(),
    status: 'idle' as 'idle' | 'recording' | 'transcribing',
    elapsedSeconds: 0,
    level: 0,
  },
  voiceConversation: {
    active: false,
    toggle: vi.fn(),
    status: 'idle' as 'idle' | 'listening' | 'transcribing' | 'thinking' | 'speaking',
    muted: false,
    toggleMute: vi.fn(),
    level: 0,
    stopTurn: vi.fn(),
  },
}));

vi.mock('../hooks/useVoiceRecorder', () => ({
  useVoiceRecorder: () => mocks.voiceRecorder,
}));

vi.mock('../hooks/useVoiceConversation', () => ({
  useVoiceConversation: () => mocks.voiceConversation,
}));

describe('Composer dictation status', () => {
  beforeEach(() => {
    mocks.voiceRecorder.dictate.mockClear();
    mocks.voiceRecorder.status = 'idle';
    mocks.voiceRecorder.elapsedSeconds = 0;
    mocks.voiceRecorder.level = 0;
    mocks.voiceConversation.active = false;
    mocks.voiceConversation.status = 'idle';
  });

  it('shows recording status while mic dictation is capturing audio', () => {
    mocks.voiceRecorder.status = 'recording';
    mocks.voiceRecorder.elapsedSeconds = 3.4;

    render(<Composer onSend={vi.fn()} onStop={vi.fn()} busy={false} />);

    expect(screen.getByRole('status')).toHaveTextContent('Recording 0:03 · tap mic to finish');
  });

  it('shows transcribing status after mic dictation stops', () => {
    mocks.voiceRecorder.status = 'transcribing';

    render(<Composer onSend={vi.fn()} onStop={vi.fn()} busy={false} />);

    expect(screen.getByRole('status')).toHaveTextContent('Transcribing voice…');
  });
});
