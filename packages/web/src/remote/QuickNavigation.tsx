import { useMemo, useRef, useState } from 'react';
import { ConfirmDialog } from './ConfirmDialog';
import { RemoteIcon } from './RemoteIcon';
import { filterNavigationCommands, type NavigationCommand, type NavigationDestination } from './quick-navigation';
import { revealDialogControl } from './dialog-focus';

/** A memory-only navigation palette, using the existing modal/focus implementation. */
export function QuickNavigation({ commands, onSelect, onDismiss }: {
  commands: readonly NavigationCommand[]; onSelect(destination: NavigationDestination): void; onDismiss(): void;
}) {
  const [query, setQuery] = useState('');
  const list = useRef<HTMLUListElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const composing = useRef(false);
  const selected = useRef(false);
  const matches = useMemo(() => filterNavigationCommands(commands, query), [commands, query]);
  const choose = (command: NavigationCommand): void => {
    if (selected.current || composing.current || command.disabledReason) return;
    selected.current = true; onSelect(command.id);
  };
  return <ConfirmDialog label="クイックナビゲーション" className="remote-quick-navigation" actionNavigation dismissOnBackdrop onDismiss={onDismiss}>
    <header className="remote-quick-navigation-heading"><h2>クイックナビゲーション</h2>
      <button onClick={onDismiss} aria-label="クイックナビゲーションを閉じる"><RemoteIcon name="close" /></button>
    </header>
    <p className="remote-meta" id="remote-navigation-help">移動先を検索。⌘ / Ctrl + Kで開き、Escで閉じます。送信・承認・停止は行いません。</p>
    <label className="remote-search"><RemoteIcon name="search" /><input ref={input} type="search" maxLength={128}
      aria-label="移動先を検索" aria-describedby="remote-navigation-help remote-navigation-count" placeholder="会話・設定・成果物…"
      autoFocus data-dialog-initial-focus value={query} onChange={event => setQuery(event.target.value)}
      onCompositionStart={() => { composing.current = true; }} onCompositionEnd={() => { composing.current = false; }}
      onKeyDown={event => {
        if (event.nativeEvent.isComposing || composing.current || event.keyCode === 229 || event.altKey || event.ctrlKey || event.metaKey) return;
        if (event.key === 'Enter') { event.preventDefault(); const first = matches.find(command => !command.disabledReason); if (first) choose(first); }
        if (['ArrowDown', 'ArrowUp'].includes(event.key)) {
          const buttons = [...(list.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') || [])];
          const target = event.key === 'ArrowDown' ? buttons[0] : buttons.at(-1);
          if (target) { event.preventDefault(); target.focus({ preventScroll: true }); const dialog = target.closest('dialog'); if (dialog) revealDialogControl(dialog, target); }
        }
      }} />
      <button className="remote-icon-button" aria-label="移動先検索をクリア" disabled={!query} onClick={() => { setQuery(''); input.current?.focus({ preventScroll: true }); }}><RemoteIcon name="close" /></button>
    </label>
    <p className="remote-meta" id="remote-navigation-count" role="status">{matches.length}件の移動先 · 会話の本文は検索しません。</p>
    <ul ref={list} className="remote-quick-navigation-results" aria-label="移動先">
      {matches.map(command => <li key={command.id}>
        <button className="remote-menu-action" aria-label={command.label} aria-describedby={`remote-navigation-${command.id}`}
          disabled={Boolean(command.disabledReason)} onClick={() => choose(command)}>
          <strong>{command.label}</strong><span className="remote-meta" id={`remote-navigation-${command.id}`}>{command.disabledReason || command.description}</span>
        </button>
      </li>)}
    </ul>
    {matches.length === 0 && <p>一致する移動先はありません。会話・設定などの名前で検索してください。</p>}
  </ConfirmDialog>;
}
