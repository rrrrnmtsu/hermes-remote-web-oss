import { useRef } from 'react';

interface AttachMenuProps {
  open: boolean;
  onClose: () => void;
  onFiles: (files: FileList | null) => void;
}

export function AttachMenu({ open, onClose, onFiles }: AttachMenuProps) {
  const filesInputRef = useRef<HTMLInputElement>(null);

  if (!open) return null;

  return (
    <>
      <button type="button" className="hm-attach-overlay" onClick={onClose} aria-label="Close attachment menu" />
      <div className="hm-attach-menu" role="menu">
        <button
          type="button"
          className="hm-attach-item"
          role="menuitem"
          onClick={() => filesInputRef.current?.click()}
        >
          <span className="hm-attach-item__icon" aria-hidden>📁</span>
          <span className="hm-attach-item__label">File</span>
        </button>
      </div>

      <input
        ref={filesInputRef}
        type="file"
        multiple
        className="hm-composer__file-input"
        onChange={(e) => {
          onFiles(e.target.files);
          onClose();
        }}
      />
    </>
  );
}
