import { useId, useRef } from 'react';
import { RemoteIcon } from './RemoteIcon';
import './DateField.css';

/** One native picker. Its host has no padding; the bounded shell owns spacing. */
export function DateField({ label, value, invalid = false, onChange }: {
  label: string; value: string; invalid?: boolean; onChange(value: string, badInput: boolean): void;
}) {
  const id = useId(), input = useRef<HTMLInputElement>(null);
  return <div className="remote-date-field">
    <label htmlFor={id}>{label}</label>
    <div className="remote-date-entry">
      <div className="remote-date-shell"><input ref={input} id={id} type="date" value={value}
        min="0001-01-01" max="9999-12-31" aria-invalid={invalid || undefined}
        onInput={event => onChange(event.currentTarget.value, event.currentTarget.validity.badInput)}
        onChange={event => onChange(event.currentTarget.value, event.currentTarget.validity.badInput)} /></div>
      <button className="remote-date-clear" type="button" aria-label={`${label}をクリア`} title={`${label}をクリア`}
        disabled={!value && !invalid} onClick={() => {
          // Reset native partial segments as well as the controlled value.
          if (input.current) input.current.value = '';
          onChange('', false);
        }}><RemoteIcon name="close" /></button>
    </div>
  </div>;
}
