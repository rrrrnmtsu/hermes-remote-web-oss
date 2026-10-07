import { describe, expect, it } from 'vitest';
import { isAllowedAttachmentMime, safeAttachmentBasename, unsupportedAttachmentTypeMessage } from './attachmentLimits';

describe('attachment limits', () => {
  it('sanitizes user-controlled attachment names to a basename', () => {
    expect(safeAttachmentBasename('../secret.txt')).toBe('secret.txt');
    expect(safeAttachmentBasename('C:\\Users\\Alice\\evil.pdf')).toBe('evil.pdf');
    expect(safeAttachmentBasename('\u0000../..//')).toBe('attachment');
    expect(safeAttachmentBasename('...')).toBe('attachment');
  });

  it('strips bidi, zero-width, and normalizes compatibility characters in attachment names', () => {
    expect(safeAttachmentBasename('invoice\u202Egpj.exe')).toBe('invoicegpj.exe');
    expect(safeAttachmentBasename('report\u200Bfinal.txt')).toBe('reportfinal.txt');
    expect(safeAttachmentBasename('full\u00A0width-ＦＯＯ.txt')).toBe('full width-FOO.txt');
  });

  it('allows a small explicit MIME surface', () => {
    expect(isAllowedAttachmentMime({ type: 'text/plain' })).toBe(true);
    expect(isAllowedAttachmentMime({ type: 'text/x-python' })).toBe(true);
    expect(isAllowedAttachmentMime({ type: 'application/json' })).toBe(true);
    expect(isAllowedAttachmentMime({ type: 'application/pdf' })).toBe(true);
    expect(isAllowedAttachmentMime({ type: 'image/png' })).toBe(true);
  });

  it('rejects unknown, empty, and executable-ish MIME types', () => {
    expect(isAllowedAttachmentMime({ type: '' })).toBe(false);
    expect(isAllowedAttachmentMime({ type: 'application/octet-stream' })).toBe(false);
    expect(isAllowedAttachmentMime({ type: 'application/x-msdownload' })).toBe(false);
    expect(unsupportedAttachmentTypeMessage('malware.exe', 'application/x-msdownload')).toContain('not an allowed attachment type');
  });
});
