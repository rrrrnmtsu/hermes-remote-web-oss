import { useDeferredValue, useMemo, useRef, useState, type MouseEvent } from 'react';
import { BOT_CONVERSATION_MAX_PAGES, BOT_CONVERSATION_PAGE_SIZE, BOT_SOURCE_INDEX_LIMIT,
  conversationBotSources, filterBotConversations, type BotConversation, type BotConversationState } from '../../../core/src/features/bot-conversations';
import { botPlatformName, type BotPlatform } from '../../../core/src/features/bots';
import type { RemoteSession } from '../../../core/src/stores/remote';

export interface BotConversationControls { state: BotConversationState; projectLabel: string; onRead(append: boolean): void; }

/** One list for loaded previews and explicitly fetched owned pages. Filters and queries stay in this scope's memory. */
export function BotConversationsPanel({ platforms, seeds, controls, canOpen, onOpen }: {
  platforms: readonly BotPlatform[]; seeds: readonly RemoteSession[]; controls?: BotConversationControls;
  canOpen: boolean; onOpen(id: string): void;
}) {
  const [source, setSource] = useState('');
  const [query, setQuery] = useState('');
  const search = useRef<HTMLInputElement>(null);
  const deferredQuery = useDeferredValue(query);
  const state = controls?.state;
  const fetched = Boolean(state?.pages);
  const rows = useMemo<BotConversation[]>(() => fetched ? state!.rows : seeds.map(row => ({
    id: row.durableId, title: row.title || '無題の会話', titleTruncated: false, source: row.source.toLowerCase(),
    startedAt: 0, pinned: false, archived: false,
  })), [fetched, state, seeds]);
  const sources = useMemo(() => conversationBotSources(rows, platforms), [rows, platforms]);
  const effectiveSource = sources.includes(source) ? source : '';
  const matches = useMemo(() => filterBotConversations(rows, sources, effectiveSource, deferredQuery), [rows, sources, effectiveSource, deferredQuery]);
  const loading = state?.load === 'loading';
  const stale = Boolean(state?.stale);
  const openAllowed = canOpen && !loading && !stale && state?.load !== 'error';
  const unverified = rows.filter(row => row.source === null).length;
  const read = (append: boolean, event: MouseEvent<HTMLButtonElement>): void => {
    // A read disables its button. Keep keyboard focus on the existing safe dialog
    // control rather than letting a now-disabled button drop focus to the page.
    if (event.currentTarget === document.activeElement) event.currentTarget.closest('dialog')
      ?.querySelector<HTMLElement>('[data-dialog-initial-focus]')?.focus({ preventScroll: true });
    controls?.onRead(append);
  };
  return <section className="remote-bot-history" aria-label="取得済みのボット会話">
    <h3>関連する会話</h3>
    {controls && <>
      <p className="remote-meta">取得対象: {state?.scope?.profile || '未接続'} / {controls.projectLabel}。所有者付きの保存会話を作成日時の新しい順に取得します。</p>
      <div className="remote-actions remote-bot-page-actions">
        <button disabled={!state?.available || loading} aria-busy={loading || undefined} onClick={event => read(false, event)}>
          {fetched ? '会話一覧を最初から再取得' : '会話一覧を取得'}
        </button>
        {fetched && state?.nextCursor && <button disabled={!state.available || loading || stale || state.pages >= BOT_CONVERSATION_MAX_PAGES}
          onClick={event => read(true, event)}>次の50件を取得</button>}
      </div>
      {!state?.available && <p className="remote-meta">この接続では所有者付きの追加取得に未対応です。現在取得済みの一覧だけを表示します。</p>}
      {loading && <p role="status">会話の取得・ボット種別の照合中…</p>}
      {state?.error && <p role="alert">{state.error}</p>}
      {stale && <p role="status">以前の取得範囲を表示しています。再取得が成功するまで、この一覧からの移動はできません。</p>}
    </>}
    <div className="remote-bot-conversation-filters">
      <label>ボットで絞り込む<select aria-label="会話のボットを選ぶ" value={effectiveSource} onChange={event => setSource(event.target.value)}>
        <option value="">すべての確認済みボット</option>
        {sources.map(id => <option key={id} value={id}>{botPlatformName(id)}</option>)}
      </select></label>
      <label>会話タイトル<input ref={search} type="search" aria-label="読み込み済みの会話タイトルを検索" value={query} maxLength={200}
        onChange={event => setQuery(event.target.value.slice(0, 200))} /></label>
      {query && <button onClick={() => { setQuery(''); search.current?.focus({ preventScroll: true }); }}>会話タイトル検索をクリア</button>}
    </div>
    {fetched ? <>
      <p className="remote-meta">保存会話{rows.length}件を取得済み / {state?.pages}ページ。うち条件に一致するボット会話{matches.length}件を表示。</p>
      <p className="remote-meta">1回{BOT_CONVERSATION_PAGE_SIZE}件・最大{BOT_CONVERSATION_MAX_PAGES}ページ。sourceは各取得時点の最近の活動から最大{BOT_SOURCE_INDEX_LIMIT}件で照合します。本文の全文検索ではありません。</p>
      {unverified > 0 && <p role="status">{unverified}件のボット種別はこの照合範囲では未確認のため、表示していません。</p>}
      {state?.pages === BOT_CONVERSATION_MAX_PAGES && state.nextCursor && <p role="status">最大4ページの取得上限に達しました。続きの会話は未取得です。</p>}
      {!state?.nextCursor && <p className="remote-meta">この所有者・profile・project・取得時点の条件に、続きのページはありません。ボットの全履歴を網羅したことは意味しません。</p>}
    </> : <p className="remote-meta">現在のprofileで取得済みの一覧から、sourceがボット名と一致する会話だけを表示します。追加取得は上のボタンを押したときだけです。</p>}
    <p className="remote-meta">絞り込みとタイトル検索は、読み込み済みの範囲だけに適用します。</p>
    {matches.length ? <ul className="remote-bot-conversations">{matches.map(row => <li key={row.id}>
      <span>{row.title}</span><span className="remote-meta">{botPlatformName(row.source!)}{row.pinned ? ' · ピン留め' : ''}
        {row.startedAt ? ` · 作成 ${new Date(row.startedAt * 1000).toLocaleString('ja-JP')}` : ''}</span>
      {row.titleTruncated && <span className="remote-meta">長いタイトルを省略しています。</span>}
      <button disabled={!openAllowed} onClick={() => onOpen(row.id)}>この会話を開く</button>
    </li>)}</ul> : <p>取得済みの一覧に、この条件の関連会話はありません。未取得・種別未確認の会話がないとは断定しません。</p>}
    {!canOpen && <p className="remote-meta">下書き・実行・確認待ち等を確認してから別の会話へ移動してください。現在の内容は保持しています。</p>}
  </section>;
}
