import { useEffect, useLayoutEffect, useMemo, useRef, useState, useCallback, type CSSProperties, type MutableRefObject } from 'react';
import type { RemoteController, RemoteState, RemoteMessage } from '../../../core/src/stores/remote';
import type { ProductAction } from './ProductControls';
import { ChatMessage } from './ChatMessage';
import { ConfirmDialog } from './ConfirmDialog';
import { Notice } from './Notice';
import { RemoteIcon } from './RemoteIcon';
import { executionLabels, phaseLabels } from './remote-labels';
import { CHAT_FONT_REM, type ChatFontSize } from './runtime';
import { captureConversationPosition, restoreConversationPosition, scrollConversationHit, type ConversationScrollMemory } from './conversation-scroll';
import { prepareSearchIndex, findSearchHits, insertQuickText, createMarkdownSnapshot, QUICK_TEXTS,
  SEARCH_QUERY_LIMIT, DISPLAY_MESSAGE_LIMIT, type SearchDocument, type SearchHit, type MarkdownSnapshot } from './chat-content';
import { ExpandedEditor, type DraftSelection } from './ExpandedEditor';
import { MarkdownSaveDialog } from './MarkdownSaveDialog';
import { insertQuote, type QuoteCandidate } from './quote-content';
import { prepareImage } from './image-content';
import { ImageAttachment } from './ImageAttachment';
import { FileAttachment } from './FileAttachment';
import { AttachmentDetails } from './AttachmentDetails';
import type { AttachmentKind } from './attachment-labels';
import { documentLimits } from '../../../core/src/features/documents';
import { prepareDocument } from './file-content';
const NO_HITS: SearchHit[] = [];

/** Follow rendered text, rather than an empty margin or an absolute action's
 * scroll overflow, when the available transcript is only one line high. */
function conversationTailTarget(node: HTMLDivElement): number {
  const bounds = node.getBoundingClientRect(), style = getComputedStyle(node);
  const top = bounds.top + (Number.parseFloat(style.paddingTop) || 0);
  const bottom = bounds.bottom - (Number.parseFloat(style.paddingBottom) || 0);
  const physicalEnd = Math.max(0, node.scrollHeight - node.clientHeight);
  const block = [...node.querySelectorAll<HTMLElement>(':scope > .remote-message, :scope > .remote-tool-activity, :scope > .remote-meta')].at(-1);
  if (!block || bottom <= top) return node.scrollHeight;
  const walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT);
  let text = walker.lastChild();
  // The final visible leaf normally resolves immediately. Keep malformed or
  // mostly hidden Markdown from turning scroll events into an unbounded scan.
  for (let inspected = 0; text && inspected < 64; inspected++, text = walker.previousNode()) {
    const parent = text.parentElement;
    if (!text.textContent?.trim() || parent?.closest('button, dialog, [data-quote-exclude], [hidden]')) continue;
    const closed = parent?.closest('details:not([open])');
    if (closed && !closed.querySelector(':scope > summary')?.contains(parent)) continue;
    let localTop = Number.NEGATIVE_INFINITY, localBottom = Number.POSITIVE_INFINITY;
    for (let ancestor = parent; ancestor && ancestor !== node; ancestor = ancestor.parentElement) {
      const css = getComputedStyle(ancestor);
      if (/(auto|scroll|hidden|clip)/.test(css.overflowY)) {
        const box = ancestor.getBoundingClientRect();
        localTop = Math.max(localTop, box.top); localBottom = Math.min(localBottom, box.bottom);
      }
    }
    const range = document.createRange(); range.selectNodeContents(text);
    // Preformatted space/tab-only rows have positive-width rectangles, but
    // contain no ink. Preserve the DOM/code and measure only through its text.
    const textEnd = text.textContent!.trimEnd().length;
    if (textEnd !== text.textContent!.length) range.setEnd(text, textEnd);
    if (typeof range.getClientRects !== 'function') { range.detach(); return node.scrollHeight; }
    const rects = [...range.getClientRects()]; range.detach();
    const rect = rects.reverse().find(rect => rect.height > 0 && rect.width > 0
      && rect.height <= bottom - top + 1
      && rect.top >= localTop - 1 && rect.bottom <= localBottom + 1);
    if (!rect) continue;
    const projectedTop = rect.top + node.scrollTop - physicalEnd;
    const projectedBottom = rect.bottom + node.scrollTop - physicalEnd;
    if (projectedTop >= top - 1 && projectedBottom <= bottom + 1) return node.scrollHeight;
    return Math.max(0, Math.min(physicalEnd, node.scrollTop + rect.bottom - bottom));
  }
  return node.scrollHeight;
}

function captureReadingPosition(node: HTMLDivElement) {
  const position = captureConversationPosition(node);
  const target = Math.min(conversationTailTarget(node), Math.max(0, node.scrollHeight - node.clientHeight));
  return { ...position, bottom: position.bottom || Math.abs(target - node.scrollTop) < 70 };
}
function restoreReadingPosition(node: HTMLDivElement, position: ReturnType<typeof captureConversationPosition>): void {
  if (position.bottom) node.scrollTo({ top: conversationTailTarget(node) });
  else restoreConversationPosition(node, position);
}

/** On reallocation only, keep the same reader anchor while revealing a line
 * clipped by at most four CSS pixels. Explicit reading/search never calls this. */
function revealReaderLine(node: HTMLDivElement, position: ReturnType<typeof captureConversationPosition>) {
  if (!position.messageId || position.bottom) return null;
  const messages = [...node.querySelectorAll<HTMLElement>('[data-message-id]')];
  const message = messages.find(item => item.dataset.messageId === position.messageId);
  if (!message) return null;
  const bounds = node.getBoundingClientRect(), css = getComputedStyle(node);
  const top = bounds.top + (Number.parseFloat(css.paddingTop) || 0);
  const bottom = bounds.bottom - (Number.parseFloat(css.paddingBottom) || 0);
  const left = bounds.left + (Number.parseFloat(css.paddingLeft) || 0);
  const right = bounds.right - (Number.parseFloat(css.paddingRight) || 0);
  if (bottom <= top) return null;
  let nearest: number | null = null, leaves = 0, runs = 0;
  for (const content of message.querySelectorAll<HTMLElement>('.remote-message-content, .remote-message-body > details > summary')) {
    const walker = document.createTreeWalker(content, NodeFilter.SHOW_TEXT); let text;
    while ((text = walker.nextNode()) && ++leaves <= 32) {
      if (!text.textContent?.trim() || text.parentElement?.closest('button, [hidden], [aria-hidden="true"]')) continue;
      let localTop = Number.NEGATIVE_INFINITY, localBottom = Number.POSITIVE_INFINITY;
      for (let ancestor = text.parentElement; ancestor && ancestor !== node; ancestor = ancestor.parentElement) {
        const style = getComputedStyle(ancestor), box = ancestor.getBoundingClientRect();
        if (/(auto|scroll|hidden|clip)/.test(style.overflowY)) {
          localTop = Math.max(localTop, box.top); localBottom = Math.min(localBottom, box.bottom);
        }
      }
      const range = document.createRange(), words = /\S+/gu; let word;
      if (typeof range.getClientRects !== 'function') { range.detach(); return null; }
      while ((word = words.exec(text.textContent)) && ++runs <= 256) {
        range.setStart(text, word.index); range.setEnd(text, word.index + word[0].length);
        for (const rect of range.getClientRects()) {
          if (rect.width <= 0 || rect.height <= 0 || rect.height > bottom - top || rect.right <= left || rect.left >= right
            || rect.top < localTop || rect.bottom > localBottom) continue;
          if (rect.top >= top && rect.bottom <= bottom) { range.detach(); return null; }
          if (rect.bottom <= top || rect.top >= bottom) continue;
          const delta = rect.top < top ? rect.top - top : rect.bottom - bottom;
          if (Math.abs(delta) <= 4 && (nearest === null || Math.abs(delta) < Math.abs(nearest))) nearest = delta;
        }
      }
      range.detach();
      if (runs > 256) break;
    }
    if (leaves > 32 || runs > 256) break;
  }
  if (nearest === null) return null;
  // WebKit may quantize scrollTop. Round outward within the same four-pixel
  // budget so a subpixel remainder does not leave the letters clipped again.
  const delta = nearest > 0 ? Math.ceil(nearest) : Math.floor(nearest);
  if (Math.abs(delta) / Math.max(1, message.getBoundingClientRect().height) > .04) return null;
  // A small shift must not replace the first remembered message with its neighbor.
  if (messages.find(item => item.getBoundingClientRect().bottom - delta > bounds.top + 1)?.dataset.messageId !== position.messageId) return null;
  node.scrollTop += delta;
  return { ...captureConversationPosition(node), bottom: false };
}

function ActivityStrip({ state, pendingCount, onStop, controller }: {
  state: RemoteState; pendingCount: number; onStop(): void; controller: RemoteController;
}) {
  const sync = state.connection === 'connected'
    ? <button onClick={() => { void controller.synchronize().catch(() => undefined); }}>再同期</button>
    : <button onClick={() => { void controller.recover(navigator.onLine); }}>再接続</button>;
  if (state.delivery === 'delivery_unknown') return <Notice tone="critical" title="送信結果不明 · 送信結果を確認できません" action={sync}>
    <p>本文を自動再送しません。再同期で履歴を確認してください。同文の履歴だけでは今回の受付を断定できません。別会話への移動は以前の実行を取り消しません。</p>
    {state.stopUnknown && <p>停止結果も不明です。接続が切れても停止済みとは扱いません。</p>}
  </Notice>;
  if (state.stopUnknown) return <Notice tone="critical" title="停止結果不明" action={sync}>
    <p>接続が切れても停止済みとは扱いません。再同期で実際の状態を確認してください。</p>
  </Notice>;
  if (state.connection !== 'connected') return <Notice tone="warning" title={phaseLabels[state.connection]}
    action={<button onClick={() => { void controller.recover(navigator.onLine); }}>再接続</button>} />;
  if (state.delivery === 'sending') return <Notice tone="info" title="メッセージを送信中…" />;
  // The scoped request card below already supplies the pending CTA.
  if (pendingCount) return null;
  if (state.execution === 'stop_requested') return <Notice tone="info" title="停止を要求しています…" />;
  if (state.execution === 'running') return <Notice tone="info" title="Hermesが処理しています…"
    action={<button aria-label="停止" onClick={onStop}><RemoteIcon name="stop" /><span>停止</span></button>} />;
  if (state.execution === 'waiting_input') return <Notice tone="action-required" title="入力待ち · 要求を確認してください" action={sync} />;
  if (state.execution === 'unknown') return <Notice tone="warning" title="実行状態を確認できません" action={sync} />;
  if (state.execution === 'failed') return <Notice tone="warning" title="実行に失敗しました" action={sync} />;
  if (state.delivery === 'failed_before_send') return <Notice tone="warning" title="送信前に失敗しました · 下書きは残っています" />;
  return null;
}

export function Conversation({ state, controller, chatFontSize = 16, scrollMemory, onBack, onRequests, onComposerFocus, onSidebar, onFeature, onDraftInserter }: {
  state: RemoteState; controller: RemoteController; onBack(): void; onRequests(): void; onComposerFocus(focused: boolean): void; onSidebar(): void;
  chatFontSize?: ChatFontSize; scrollMemory?: MutableRefObject<ConversationScrollMemory | null>;
  onFeature?(action: ProductAction, message?: RemoteMessage): void; onDraftInserter?(insert: ((text: string) => void) | null): void;
}) {
  const scroller = useRef<HTMLDivElement>(null);
  const composer = useRef<HTMLTextAreaElement>(null);
  const layout = useRef<HTMLElement>(null);
  const composerContext = useRef<HTMLDivElement>(null);
  const composerActions = useRef<HTMLDivElement>(null);
  const searchControls = useRef<HTMLElement>(null);
  const atBottom = useRef(true);
  const readingGeometry = useRef<{ width: number; height: number; scrollHeight: number; scrollTop: number } | null>(null);
  const allocationTail = useRef(false);
  const allocationNativeTop = useRef<number | null>(null);
  const readingGesture = useRef(false);
  const requestReadingLayout = useRef<() => void>(() => undefined);
  const markReadingGesture = (): void => {
    allocationTail.current = false; allocationNativeTop.current = null; readingGesture.current = true;
    // Ordinary scrolling may not resize anything. Give its capture-only veto
    // the same finite lifetime rather than carrying it into a later font change.
    requestReadingLayout.current();
  };
  const followTail = useCallback((node: HTMLDivElement): void => {
    node.scrollTo({ top: conversationTailTarget(node) });
    readingGeometry.current = { width: node.clientWidth, height: node.clientHeight, scrollHeight: node.scrollHeight, scrollTop: node.scrollTop };
  }, []);
  const [hasNew, setHasNew] = useState(false);
  const [menu, setMenu] = useState(false);
  const menuTrigger = useRef<HTMLButtonElement>(null);
  const queryInput = useRef<HTMLInputElement>(null);
  const queryComposing = useRef(false);
  const [stopConfirm, setStopConfirm] = useState(false);
  const [inputFocused, setInputFocused] = useState(false);
  const composing = useRef(false);
  const [isComposing, setIsComposing] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const searching = useRef(false);
  searching.current = searchOpen;
  const [query, setQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [selectedHit, setSelectedHit] = useState(0);
  const searchCache = useRef(new Map<string, SearchDocument>());
  const [auxiliary, setAuxiliary] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const selection = useRef<DraftSelection | null>(null);
  const insertion = useRef<(text: string) => void>(() => undefined);
  insertion.current = text => {
    if (composing.current) return;
    const inserted = insertQuickText(controller.store.getState().draft, text, selection.current?.start);
    controller.setDraft(inserted.draft); selection.current = { start: inserted.caret, end: inserted.caret };
    restoreComposer();
  };
  useEffect(() => { onDraftInserter?.(text => insertion.current(text)); return () => onDraftInserter?.(null); }, [onDraftInserter]);
  const [exportSnapshot, setExportSnapshot] = useState<MarkdownSnapshot | null>(null);
  const [quote, setQuote] = useState<QuoteCandidate | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const documentInput = useRef<HTMLInputElement>(null);
  const [imageError, setImageError] = useState('');
  const [imageReading, setImageReading] = useState(false);
  const [selectionKind, setSelectionKind] = useState<AttachmentKind>('image');
  // A token identifies this local selection without retaining another bytes snapshot.
  const attachmentIdentity = useMemo(() => ({ selected: Boolean(state.attachment?.bytes || state.document?.bytes) }), [state.attachment?.bytes, state.document?.bytes]);
  const [attachmentDetails, setAttachmentDetails] = useState<{ kind: AttachmentKind; scope: string; identity: object } | null>(null);
  useEffect(() => { setAttachmentDetails(null); }, [state.profile, state.liveId, attachmentIdentity]);
  const imageRevision = useRef(0);
  const imageAbort = useRef<AbortController | null>(null);
  useEffect(() => () => {
    imageRevision.current++; imageAbort.current?.abort(); controller.setImageSelecting(false, state.profile, state.liveId);
  }, [controller, state.profile, state.liveId]);
  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedQuery(query), 160);
    return () => window.clearTimeout(timer);
  }, [query]);
  const index = useMemo(() => searchOpen ? prepareSearchIndex(state.messages, searchCache.current) : null, [searchOpen, state.messages]);
  const searchResult = useMemo(() => index && query === debouncedQuery ? findSearchHits(index, debouncedQuery) : { hits: [], limited: index?.limited ?? false }, [index, query, debouncedQuery]);
  const searchHits = searchResult.hits;
  const activeHit = Math.min(selectedHit, searchResult.hits.length - 1);
  const hitsByMessage = useMemo(() => {
    const grouped = new Map<string, SearchHit[]>();
    for (const hit of searchHits) grouped.set(hit.messageId, [...(grouped.get(hit.messageId) || []), hit]);
    return grouped;
  }, [searchHits]);
  const scope = `${state.profile}:${state.liveId}`;
  const localPosition = useRef(scrollMemory?.current?.scope === scope ? scrollMemory.current.position : null);
  useLayoutEffect(() => {
    const node = scroller.current;
    if (!node) return;
    if (localPosition.current?.bottom) followTail(node);
    else if (localPosition.current) restoreReadingPosition(node, localPosition.current);
    atBottom.current = localPosition.current?.bottom ?? true;
    return () => {
      // List/modal teardown can reflow the old node before this cleanup. Keep
      // its already classified reading intent, including pending user vetoes.
      const position = { ...captureReadingPosition(node), bottom: atBottom.current && !searching.current && !readingGesture.current };
      localPosition.current = position;
      if (scrollMemory) scrollMemory.current = { scope, position };
    };
  }, [scope, scrollMemory, followTail]);
  useLayoutEffect(() => {
    if (scroller.current && localPosition.current?.bottom) followTail(scroller.current);
    else if (scroller.current && localPosition.current) restoreReadingPosition(scroller.current, localPosition.current);
  }, [chatFontSize, followTail]);
  const previousContent = useRef<string | null>(null);
  const pending = state.requests.filter(card => card.profile === state.profile && card.sessionId === state.liveId
    && ['pending', 'checking', 'response_unknown'].includes(card.status));
  const latest = state.messages.at(-1)?.text;
  useLayoutEffect(() => {
    const signature = `${state.messages.length}:${latest ?? ''}:${state.tools.length}:${pending.length}`;
    if (atBottom.current && !searching.current && scroller.current) followTail(scroller.current);
    else if (previousContent.current !== null && previousContent.current !== signature) setHasNew(true);
    previousContent.current = signature;
  }, [latest, state.messages.length, state.tools, pending.length, followTail]);
  useLayoutEffect(() => {
    const input = composer.current;
    if (!input) return;
    let frame = 0;
    let measured = '';
    const resize = (): void => {
      frame = 0;
      if (!input.isConnected) return;
      let layoutChanged = false;
      const style = window.getComputedStyle(input);
      const line = Number.parseFloat(style.lineHeight) || 24;
      const padding = (Number.parseFloat(style.paddingTop) || 0) + (Number.parseFloat(style.paddingBottom) || 0)
        + (Number.parseFloat(style.borderTopWidth) || 0) + (Number.parseFloat(style.borderBottomWidth) || 0);
      const minimum = Math.max(44, line + padding);
      const viewportText = document.documentElement.style.getPropertyValue('--remote-height');
      const visibleHeight = /^\d+(?:\.\d+)?px$/.test(viewportText) ? Number.parseFloat(viewportText)
        : Math.abs((window.visualViewport?.scale ?? 1) - 1) > .05 ? window.innerHeight : window.visualViewport?.height ?? window.innerHeight;
      let available = visibleHeight * .32;
      let contextMinimum = 0, remaining = Number.POSITIVE_INFINITY;
      const section = layout.current, form = input.closest('form'), context = composerContext.current, actions = composerActions.current;
      if (section && form && context && actions && section.getBoundingClientRect().height > 0 && actions.getBoundingClientRect().height > 0) {
        const verticalSpace = (node: Element): number => {
          const css = getComputedStyle(node);
          return ['padding-top', 'padding-bottom', 'border-top-width', 'border-bottom-width']
            .reduce((sum, property) => sum + (Number.parseFloat(css.getPropertyValue(property)) || 0), 0);
        };
        const dock = form.parentElement!;
        const heading = section.querySelector('.remote-chat-heading');
        const transcript = scroller.current;
        const actionStyle = getComputedStyle(actions);
        const actionHeight = actions.getBoundingClientRect().height + (Number.parseFloat(actionStyle.marginTop) || 0)
          + (Number.parseFloat(actionStyle.marginBottom) || 0);
        const file = context.querySelector('.remote-file-attachment'), fileActions = context.querySelector('.remote-file-actions');
        const image = context.querySelector('.remote-image-attachment');
        const imageControls = [...(image?.querySelectorAll('button') || [])]
          .reduce((maximum, node) => Math.max(maximum, node.getBoundingClientRect().height), 0);
        const request = context.querySelector('.remote-action-required');
        const activity = context.querySelector('.remote-activity-strip');
        const activityHeight = activity?.getBoundingClientRect().height || 0;
        const info = context.querySelector(':scope > p.remote-meta');
        const infoStyle = info ? getComputedStyle(info) : null;
        const infoHeight = infoStyle ? Math.ceil(Number.parseFloat(infoStyle.lineHeight) || (Number.parseFloat(infoStyle.fontSize) || 13) * 1.6)
          + (Number.parseFloat(infoStyle.marginTop) || 0) + (Number.parseFloat(infoStyle.marginBottom) || 0) : 0;
        const priorityMinimum = request ? request.getBoundingClientRect().height
          : activityHeight ? activityHeight + (Number.parseFloat(getComputedStyle(activity!).marginBottom) || 0)
            : file && fileActions ? fileActions.getBoundingClientRect().height + verticalSpace(file)
              : image ? imageControls + verticalSpace(image) : infoHeight;
        contextMinimum = context.scrollHeight ? Math.min(context.scrollHeight, priorityMinimum) : 0;
        const contextText = `${contextMinimum}px`;
        if (context.style.getPropertyValue('--remote-context-min-height') !== contextText) { context.style.setProperty('--remote-context-min-height', contextText); layoutChanged = true; }
        const message = transcript?.querySelector('.remote-message:not(.remote-message-system)');
        const readingLine = message ? Number.parseFloat(getComputedStyle(message).lineHeight) : Number.NaN;
        const configuredLine = (Number.parseFloat(getComputedStyle(document.documentElement).fontSize) || 16) * chatFontSize / 16 * 1.6;
        const minimumReadingLine = Math.ceil(Math.max(readingLine || 0, configuredLine)) + 1;
        // The actual header/action rows and bounded metadata, rather than a
        // viewport percentage alone, determine space remaining for the editor.
        // Keep one real body line; metadata may scroll but controls never shrink.
        remaining = section.getBoundingClientRect().height - (heading?.getBoundingClientRect().height || 0)
          - (transcript ? verticalSpace(transcript) : 0) - minimumReadingLine - verticalSpace(dock) - verticalSpace(form) - actionHeight;
        const search = searchControls.current;
        if (search) {
          const row = search.querySelector('.remote-search-input');
          const searchMinimum = (row?.getBoundingClientRect().height || 44) + verticalSpace(search);
          const searchMaximum = Math.max(searchMinimum, Math.floor(Math.min(search.scrollHeight + verticalSpace(search), remaining - contextMinimum - minimum)));
          for (const [property, value] of [['--remote-search-min-height', searchMinimum], ['--remote-search-max-height', searchMaximum]] as const) {
            const text = `${value}px`;
            if (search.style.getPropertyValue(property) !== text) { search.style.setProperty(property, text); layoutChanged = true; }
          }
          remaining -= search.getBoundingClientRect().height;
        }
        available = Math.min(available, remaining - contextMinimum);
      }
      const limit = Math.max(minimum, Math.min(line * 6 + padding, available));
      const key = [input.value, input.getBoundingClientRect().width, style.fontSize, line, padding, limit].join('\u0000');
      if (key !== measured) {
        measured = key;
        input.style.height = '0px';
        const naturalHeight = input.scrollHeight;
        // The temporary measurement can enlarge the transcript and clamp its
        // scroll position even when the final box has exactly its old size.
        // Record that observed native position, never arbitrary later movement.
        if (scroller.current && atBottom.current && !searching.current && !readingGesture.current) {
          allocationTail.current = true; allocationNativeTop.current = scroller.current.scrollTop;
        }
        input.style.height = `${Math.ceil(Math.max(minimum, Math.min(naturalHeight, limit)))}px`;
        layoutChanged = true;
      }
      if (context && Number.isFinite(remaining)) {
        const maximum = `${Math.max(contextMinimum, Math.floor(remaining - Number.parseFloat(input.style.height)))}px`;
        if (context.style.getPropertyValue('--remote-context-max-height') !== maximum) { context.style.setProperty('--remote-context-max-height', maximum); layoutChanged = true; }
      }
      if (layoutChanged) requestReadingLayout.current();
    };
    const schedule = (): void => { if (!frame) frame = window.requestAnimationFrame(resize); };
    resize();
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(schedule);
    for (const node of [layout.current, composerActions.current, layout.current?.querySelector('.remote-chat-heading'), searchControls.current]) {
      if (node) observer?.observe(node);
    }
    window.addEventListener('resize', schedule);
    return () => {
      window.cancelAnimationFrame(frame);
      observer?.disconnect();
      window.removeEventListener('resize', schedule);
    };
  }, [state.draft, expanded, searchOpen, chatFontSize, state.attachment, state.document, state.connection, state.delivery, state.execution,
    state.generationAllowed, state.generationReason, state.documentDiagnostic, state.imageDiagnostic,
    state.stopUnknown, pending.length, imageReading, imageError, hasNew]);
  useEffect(() => {
    const node = scroller.current;
    if (!node || typeof ResizeObserver === 'undefined') return;
    // Keep visual anchors independent of message arrival and browser text size.
    // Defer layout writes outside observer delivery and coalesce resize bursts.
    let frame: number | null = null, disposed = false, followLayout = false;
    const schedule = (): void => {
      if (disposed || frame !== null) return;
      frame = window.requestAnimationFrame(() => {
        frame = null;
        const settleLayout = followLayout; followLayout = false;
        if (disposed || !node.isConnected || searching.current) {
          allocationTail.current = false; allocationNativeTop.current = null; readingGesture.current = false; return;
        }
        if (readingGesture.current) {
          allocationTail.current = false;
          localPosition.current = captureReadingPosition(node); atBottom.current = localPosition.current.bottom;
        }
        if (!readingGesture.current) {
          if (atBottom.current) followTail(node);
          else if (localPosition.current && !localPosition.current.bottom) {
            const previous = readingGeometry.current;
            const reallocated = settleLayout || previous && (previous.width !== node.clientWidth || previous.height !== node.clientHeight);
            restoreReadingPosition(node, localPosition.current);
            if (reallocated) {
              const adjusted = revealReaderLine(node, localPosition.current);
              if (adjusted) localPosition.current = adjusted;
            }
          }
        }
        // Native caret reveal may follow a composer allocation in the next
        // rendering step, even when the final transcript box is unchanged.
        // One allocation-bound follow-up handles that step; user reading and
        // search are rechecked immediately before either frame moves anything.
        if (settleLayout) schedule();
        else { allocationTail.current = false; allocationNativeTop.current = null; readingGesture.current = false; }
      });
    };
    const requestLayout = (): void => {
      // Allocation can cause native caret anchoring before our first frame.
      // Retain its prior tail intent only for this existing two-frame settle.
      if (atBottom.current && !searching.current && !readingGesture.current) allocationTail.current = true;
      followLayout = true; schedule();
    };
    requestReadingLayout.current = requestLayout;
    const observer = new ResizeObserver(schedule);
    observer.observe(node);
    const fontGeometry = (): string => {
      const message = node.querySelector('.remote-message:not(.remote-message-system)');
      const style = getComputedStyle(message || node);
      return [getComputedStyle(document.documentElement).fontSize, style.fontSize, style.lineHeight].join(':');
    };
    let previousFont = fontGeometry();
    // A root text-size change need not resize the transcript container itself.
    // Inspect font changes only; viewport/style writes are not another scroll loop.
    const fonts = new MutationObserver(() => {
      const currentFont = fontGeometry();
      if (currentFont !== previousFont) { previousFont = currentFont; requestLayout(); }
    });
    fonts.observe(document.documentElement, { attributes: true, attributeFilter: ['style', 'class'] });
    return () => {
      disposed = true;
      allocationTail.current = false; allocationNativeTop.current = null; readingGesture.current = false;
      if (requestReadingLayout.current === requestLayout) requestReadingLayout.current = () => undefined;
      observer.disconnect();
      fonts.disconnect();
      if (frame !== null) window.cancelAnimationFrame(frame);
    };
  }, [scope, followTail]);
  const title = [...state.sessions, ...state.projectSessions, ...state.projects.flatMap(project => project.previews)]
    .find(session => [state.durableId, state.lineageId].includes(session.durableId))?.title || 'Hermesとの会話';
  // The existing safety guard and controller semantics are preserved.
  const sendEnabled = state.generationAllowed !== false && !state.featureBusy && state.connection === 'connected' && state.delivery !== 'sending' && state.delivery !== 'delivery_unknown'
    && ['idle', 'completed', 'stopped'].includes(state.execution) && Boolean(state.draft.trim()) && Boolean(navigator.locks)
    && !imageReading && !state.submitInProgress && !state.sessionLoading && (!state.attachment || controller.imageTransferAvailable && state.attachment.status === 'selected')
    && (!state.document || controller.documentTransferAvailable && state.document.status === 'selected')
    && !['checking', 'foreign', 'unknown'].includes(state.imageQueue);
  const canStop = state.connection === 'connected' && ['running', 'waiting_input'].includes(state.execution);
  const canExport = !['running', 'waiting_input', 'stop_requested', 'unknown'].includes(state.execution) && pending.length === 0 && state.delivery !== 'sending' && state.delivery !== 'delivery_unknown';
  const rememberSelection = (): void => {
    const input = composer.current;
    if (input) selection.current = { start: input.selectionStart, end: input.selectionEnd };
  };
  const restoreComposer = (): void => {
    // Modal close/focus events must not replace the intended caret before this frame.
    const position = selection.current ? { ...selection.current } : null;
    window.requestAnimationFrame(() => {
      const input = composer.current;
      if (input) {
        input.focus({ preventScroll: true });
        input.setSelectionRange(position?.start ?? input.value.length, position?.end ?? input.value.length);
      }
    });
  };
  const composition = (value: boolean): void => { composing.current = value; setIsComposing(value); };
  const navigateHit = (step: number): void => {
    if (!searchResult.hits.length) return;
    const next = (activeHit + step + searchResult.hits.length) % searchResult.hits.length;
    setSelectedHit(next);
    const node = scroller.current;
    const mark = node?.querySelector<HTMLElement>(`[data-chat-hit="${next}"]`);
    if (node && mark) { atBottom.current = false; scrollConversationHit(node, mark); }
  };
  const activeTool = state.tools.find(tool => tool.status === '実行中');
  const hasActivity = state.stopUnknown || state.connection !== 'connected' || pending.length > 0
    || ['delivery_unknown', 'sending', 'failed_before_send'].includes(state.delivery)
    || ['stop_requested', 'running', 'waiting_input', 'unknown', 'failed'].includes(state.execution);
  const showImageNotice = Boolean(imageError || state.imageDiagnostic && (state.attachment?.status !== 'selected' || state.delivery === 'failed_before_send'));
  const documentLimit = documentLimits(state.documentCapabilities);
  const hasContext = state.generationAllowed === false || hasActivity || Boolean(state.attachment || state.document)
    || Boolean(state.documentDiagnostic && state.document?.status !== 'selected') || imageReading || showImageNotice;
  const contextPriority = pending.length ? 'request' : hasActivity ? 'activity' : state.attachment ? 'image' : state.document ? 'document' : 'information';
  useLayoutEffect(() => {
    // New urgent state or a local selection starts with its actual action row.
    // Only this metadata scroller moves; the history reader/draft remain intact.
    if (composerContext.current) composerContext.current.scrollTop = 0;
  }, [scope, contextPriority, state.connection, state.delivery, state.execution, state.stopUnknown, state.attachment?.status, state.document?.status]);
  const closeSearch = (): void => {
    queryComposing.current = false;
    setSearchOpen(false); setQuery(''); setDebouncedQuery(''); searchCache.current.clear(); setSelectedHit(0);
    const node = scroller.current; atBottom.current = Boolean(node && captureReadingPosition(node).bottom);
    menuTrigger.current?.focus({ preventScroll: true });
  };
  return <section ref={layout} className="remote-conversation" aria-label="会話" style={{ '--chat-body-font-size': CHAT_FONT_REM[chatFontSize] } as CSSProperties}>
    <header className="remote-chat-heading" aria-label="会話ヘッダー">
      <button className="remote-back remote-icon-button" aria-label="← 会話一覧" onClick={onBack}><RemoteIcon name="back" /></button>
      <div className="remote-heading-copy"><strong title={title}>{title}</strong>
        <span className="remote-chat-state" role="status" data-execution={state.execution}>
          <span className="remote-connection-dot" data-connection={state.connection} aria-label={phaseLabels[state.connection]} title={phaseLabels[state.connection]} />
          {executionLabels[state.execution]}{state.connection !== 'connected' && <span> · {phaseLabels[state.connection]}</span>}
        </span>
      </div>
      <button ref={menuTrigger} className="remote-icon-button" aria-label="会話メニュー" aria-haspopup="dialog" aria-expanded={menu} onClick={() => setMenu(true)}><RemoteIcon name="more" /></button>
    </header>
    {menu && <ConfirmDialog label="会話メニュー" className="remote-sheet remote-chat-menu" actionNavigation dismissOnBackdrop onDismiss={() => setMenu(false)}>
      <div className="remote-sheet-heading"><h2>会話メニュー</h2><button autoFocus data-dialog-initial-focus onClick={() => setMenu(false)}>閉じる</button></div>
      <button className="remote-menu-action" onClick={() => { setMenu(false); onSidebar(); }}><RemoteIcon name="menu" />セッションを選ぶ</button>
      <button className="remote-menu-action" onClick={() => { setMenu(false); setSearchOpen(true); atBottom.current = false; }}>この会話を検索</button>
      {onFeature && state.featureMethods?.includes('remote.session.metadata') && <button className="remote-menu-action" onClick={() => { setMenu(false); onFeature('organize'); }}>名前・ピン・アーカイブ</button>}
      {onFeature && <button className="remote-menu-action" onClick={() => { setMenu(false); onFeature('info'); }}>モデル・実行情報</button>}
      {onFeature && <button className="remote-menu-action" onClick={() => { setMenu(false); onFeature('artifacts'); }}>成果物</button>}
      {onFeature && <button className="remote-menu-action" onClick={() => { setMenu(false); onFeature('files'); }}>プロジェクトのファイル</button>}
      <button className="remote-menu-action" disabled={!canExport} onClick={() => { setMenu(false); setExportSnapshot(createMarkdownSnapshot(state.messages, new Date(), ['failed', 'stopped'].includes(state.execution))); }}>会話をMarkdownで保存</button>
      {!canExport && <p className="remote-meta">実行・確認待ち・結果不明の間は保存できません。状態を確認してから保存してください。</p>}
      <button className="remote-menu-action" disabled={state.connection !== 'connected'} onClick={() => { setMenu(false); void controller.synchronize().catch(() => undefined); }}>再同期</button>
      {canStop && <button className="remote-menu-action" onClick={() => { setMenu(false); setStopConfirm(true); }}>停止</button>}
      <button className="remote-menu-action" onClick={() => { setMenu(false); onRequests(); }}>確認待ち{pending.length ? ` (${pending.length})` : ''}</button>
      <details className="remote-session-details"><summary>会話の詳細</summary>
        <dl><dt>profile</dt><dd>{state.profile}</dd><dt>接続状態</dt><dd>{phaseLabels[state.connection]}</dd>
          <dt>実行状態</dt><dd>{executionLabels[state.execution]}</dd>
          <dt>保存ID</dt><dd>{state.durableId || '未保存'}</dd><dt>live ID</dt><dd>{state.liveId}</dd>
          <dt>再開元保存ID</dt><dd>{state.lineageId || '新規'}</dd>
          <dt>最終同期</dt><dd>{state.lastSync ? new Date(state.lastSync).toLocaleString('ja-JP') : '未同期'}</dd></dl>
      </details>
    </ConfirmDialog>}
    {exportSnapshot && <MarkdownSaveDialog snapshot={exportSnapshot} onDismiss={() => setExportSnapshot(null)} />}
    {quote && <ConfirmDialog label="引用して質問" className="remote-sheet remote-quote" onDismiss={() => setQuote(null)}>
      <div className="remote-sheet-heading"><h2>引用して質問</h2><button autoFocus onClick={() => setQuote(null)}>閉じる</button></div>
      <p className="remote-meta">{quote.selected ? '選択した表示本文' : 'この発言の表示本文'}を下書きへ挿入します。送信はしません。</p>
      {quote.selectionRejected && <p className="remote-meta">選択がこの発言の本文内に収まらないため、この発言の表示本文だけを候補にしています。</p>}
      {quote.limited && <p role="alert">{quote.characters.toLocaleString('ja-JP')}文字のうち先頭8,000文字です。残りは省略します。範囲を選び直す場合は閉じてください。</p>}
      <pre className="remote-quote-preview">{quote.text}</pre>
      {selection.current && selection.current.start !== selection.current.end && <p className="remote-meta">選択中の下書きは残し、その先頭位置へ挿入します。</p>}
      <button className="remote-menu-action" disabled={isComposing} onClick={() => {
        const current = controller.store.getState();
        if (composing.current || quote.scope !== `${current.profile}:${current.liveId}` || ['reauth', 'logged_out'].includes(current.connection)) { setQuote(null); return; }
        const inserted = insertQuote(current.draft, quote, selection.current?.start);
        controller.setDraft(inserted.draft); selection.current = { start: inserted.caret, end: inserted.caret };
        setQuote(null); restoreComposer();
      }}>{quote.limited ? '省略を確認して下書きへ挿入' : '下書きへ挿入'}</button>
    </ConfirmDialog>}
    {searchOpen && <section ref={searchControls} className="remote-chat-search" aria-label="この会話の本文検索" tabIndex={0} onKeyDown={event => {
      if (event.key !== 'Escape' || event.nativeEvent.isComposing || queryComposing.current) return;
      event.preventDefault(); closeSearch();
    }}>
      <div className="remote-search-controls">
      <div className="remote-search-input"><label className="remote-sr-only" htmlFor="remote-chat-query">会話内の検索語</label>
        <input ref={queryInput} autoFocus id="remote-chat-query" type="search" value={query} maxLength={SEARCH_QUERY_LIMIT} placeholder="本文を検索…"
          onCompositionStart={() => { queryComposing.current = true; }} onCompositionEnd={() => { queryComposing.current = false; }}
          onChange={event => { setQuery(event.target.value.slice(0, SEARCH_QUERY_LIMIT)); setSelectedHit(0); }} />
        <button className="remote-search-clear" aria-label="本文検索をクリア" disabled={!query} onClick={() => { setQuery(''); setSelectedHit(0); queryInput.current?.focus({ preventScroll: true }); }}>クリア</button>
        <button className="remote-icon-button" aria-label="本文検索を閉じる" title="本文検索を閉じる" onClick={closeSearch}><RemoteIcon name="close" /></button>
      </div>
      <div className="remote-search-navigation"><span role="status">{query !== debouncedQuery ? '検索中…' : `${searchResult.hits.length ? activeHit + 1 : 0} / ${searchResult.hits.length}件`}</span>
        <button aria-label="前の一致" disabled={!searchResult.hits.length} onClick={() => navigateHit(-1)}>前へ</button>
        <button aria-label="次の一致" disabled={!searchResult.hits.length} onClick={() => navigateHit(1)}>次へ</button></div>
      </div>
      <p className="remote-meta">読み込み済みの本文を検索 · {index?.documents.length ?? 0}発言</p>
      {searchResult.limited && <details className="remote-search-limits"><summary>範囲打切り</summary><p className="remote-meta">
        表示中の最新400件の先頭から本文50万文字・各8万文字・一致200件までを検索しています。大文字小文字を区別します。
      </p></details>}
    </section>}
    {stopConfirm && <ConfirmDialog label="停止確認" onDismiss={() => setStopConfirm(false)}>
      <p>この会話の実行停止を要求します。実施済みの変更は巻き戻しません。停止完了はサーバー状態で確認します。</p>
      <button onClick={() => { setStopConfirm(false); void controller.stop(); }}>停止を要求</button><button autoFocus data-dialog-initial-focus onClick={() => setStopConfirm(false)}>戻る</button>
    </ConfirmDialog>}
    <div className="remote-transcript" ref={scroller} onWheel={markReadingGesture} onTouchMove={markReadingGesture}
      onPointerDown={event => { if (event.target === event.currentTarget) markReadingGesture(); }}
      onKeyDown={event => { if (['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End', ' '].includes(event.key)) markReadingGesture(); }}
      onScroll={() => {
      const node = scroller.current;
      if (node) {
        const position = captureReadingPosition(node), previous = readingGeometry.current;
        const resized = previous && (previous.width !== node.clientWidth || previous.height !== node.clientHeight || previous.scrollHeight !== node.scrollHeight);
        const clampedPrevious = previous ? Math.min(previous.scrollTop, Math.max(0, node.scrollHeight - node.clientHeight)) : 0;
        // Native caret anchoring may shift an allocation's old end. Its bounded
        // follow intent is distinct from wheel/touch/key/scrollbar reading.
        const nativeAllocation = allocationTail.current && allocationNativeTop.current !== null
          && Math.abs(node.scrollTop - allocationNativeTop.current) <= 1;
        if (atBottom.current && !searching.current && !readingGesture.current
          && (nativeAllocation || resized && Math.abs(node.scrollTop - clampedPrevious) <= 1)) position.bottom = true;
        if (readingGesture.current && previous && node.scrollTop < previous.scrollTop) position.bottom = false;
        localPosition.current = position; atBottom.current = position.bottom;
        readingGeometry.current = { width: node.clientWidth, height: node.clientHeight, scrollHeight: node.scrollHeight, scrollTop: node.scrollTop };
        if (atBottom.current) setHasNew(false);
      }
    }}>
      {state.messages.length === 0 && <div className="remote-chat-empty"><h1>何から始めましょうか</h1><p>メッセージを書いて、送信してください。</p></div>}
      {state.messages.slice(-DISPLAY_MESSAGE_LIMIT).filter(message => Boolean(message.text)).map(message => <ChatMessage key={message.id} message={message} searchHits={hitsByMessage.get(message.id) ?? NO_HITS} activeHit={activeHit}
        quoteScope={scope} onQuote={candidate => { if (candidate.scope === `${controller.store.getState().profile}:${controller.store.getState().liveId}`) setQuote(candidate); }}
        {...(onFeature && state.featureMethods?.includes('remote.session.branch_from_row') ? { onBranch: (mode: 'branch' | 'edit' | 'regenerate') => onFeature(mode, message) } : {})}
        {...(onFeature ? { onReadAloud: () => onFeature('read-aloud', { ...message, text: message.text.slice(0, 8000) }) } : {})} />)}
      {state.messages.length > 400 && <p className="remote-meta">画面には最新400件を表示しています。</p>}
      {state.tools.length > 0 && <details className="remote-tool-activity"><summary>
        {activeTool ? `${activeTool.name} · ${activeTool.status}` : `${state.tools.length}件のツールを実行`}
      </summary><p className="remote-meta">取得済みの最新200件まで</p>
        {state.tools.map(tool => <details key={tool.id}><summary>{tool.name} · {tool.status}</summary><pre>{tool.detail.slice(0, 12000)}</pre>{tool.detail.length > 12000 && <p>12,000文字で表示を省略しています。</p>}</details>)}
      </details>}
    </div>
    <div className="remote-composer-dock">
      <div ref={composerContext} className="remote-composer-context" tabIndex={hasContext ? 0 : undefined}
        role={hasContext ? 'region' : undefined} aria-label={hasContext ? '会話の補助状態' : undefined}
        style={{ '--remote-context-min-height': hasContext ? '46px' : '0px' } as CSSProperties}>
      {pending.length > 0 && <article className="remote-action-required" aria-label="この会話の確認要求">
        <div><strong>Hermesが確認を求めています</strong><p>
          {pending.some(card => card.status === 'response_unknown') ? '回答結果不明 · 再確認が必要です' : pending[0]?.method === 'approval' ? 'コマンド実行の承認' : '追加質問への回答'}
          {pending.length > 1 ? ` · ${pending.length}件` : ''}
        </p></div><button onClick={onRequests}>確認する</button>
      </article>}
      <div className="remote-activity-strip"><ActivityStrip state={state} pendingCount={pending.length}
        controller={controller} onStop={() => setStopConfirm(true)} /></div>
      {state.attachment && <ImageAttachment image={state.attachment} localOnly={!controller.imageTransferAvailable}
        onDetails={() => setAttachmentDetails({ kind: 'image', scope, identity: attachmentIdentity })} onCancel={() => { void controller.cancelImage(); }} />}
      {state.document && <FileAttachment document={state.document} localOnly={!controller.documentTransferAvailable} capabilities={state.documentCapabilities}
        onDetails={() => setAttachmentDetails({ kind: 'document', scope, identity: attachmentIdentity })} onCancel={() => controller.cancelDocument()} />}
      {state.generationAllowed === false && <p className="remote-meta" role="status">{state.generationReason}</p>}
      {state.documentDiagnostic && state.document?.status !== 'selected' && <p className="remote-meta" role="status">{state.documentDiagnostic}</p>}
      {imageReading && <p className="remote-meta" role="status">端末内で{selectionKind === 'document' ? '資料' : '画像'}を確認中… 転送していません。</p>}
      {showImageNotice && <details className="remote-image-notice" open>
        <summary>{imageError ? `${selectionKind === 'document' ? '資料' : '画像'}を追加できません` : state.attachment && state.attachment.status !== 'selected' || controller.imageTransferAvailable ? '画像の状態と注意' : '画像送信は未対応 · プレビューのみ'}</summary>
        <p className="remote-meta" role={imageError ? 'alert' : 'status'}>{imageError || state.imageDiagnostic}</p>
      </details>}
      </div>
      <form className="remote-composer" onBlur={event => {
        if (!event.currentTarget.contains(event.relatedTarget)) setInputFocused(false);
      }} onSubmit={event => { event.preventDefault(); if (!composing.current && sendEnabled) void controller.submit(); }}>
        <input ref={documentInput} type="file" accept=".txt,.md,.markdown,.csv,.pdf" hidden aria-label="TXT・Markdown・CSV・PDFを1つ選択" onChange={event => {
          const file = event.target.files?.[0]; event.target.value = ''; if (!file) return;
          const revision = ++imageRevision.current, generation = controller.imageSelectionGeneration;
          imageAbort.current?.abort(); const abort = new AbortController(); imageAbort.current = abort;
          const profile = state.profile, liveId = state.liveId;
          setSelectionKind('document'); setImageReading(true); controller.setImageSelecting(true, profile, liveId); setImageError('');
          void prepareDocument(file, state.documentCapabilities ?? undefined, abort.signal).then(document => {
            if (revision === imageRevision.current && !controller.selectDocument(document, profile, liveId, generation)) setImageError('会話・接続が変わったため資料を追加しませんでした。現在の会話で選び直してください。');
          }, error => { if (revision === imageRevision.current) setImageError(error instanceof Error ? error.message : '資料を確認できません。'); })
            .finally(() => { if (revision === imageRevision.current) { setImageReading(false); controller.setImageSelecting(false, profile, liveId); } });
        }} />
        <input ref={fileInput} type="file" accept="image/jpeg,image/png" hidden aria-label="JPEGまたはPNGを1枚選択" onChange={event => {
          const file = event.target.files?.[0]; event.target.value = ''; if (!file) return;
          const revision = ++imageRevision.current, generation = controller.imageSelectionGeneration;
          imageAbort.current?.abort(); const abort = new AbortController(); imageAbort.current = abort;
          const profile = state.profile, liveId = state.liveId;
          setSelectionKind('image'); setImageReading(true); controller.setImageSelecting(true, profile, liveId); setImageError('');
          void prepareImage(file, controller.imageLimit, abort.signal).then(image => {
            if (revision === imageRevision.current && !controller.selectImage(image, profile, liveId, generation)) setImageError('会話・接続が変わったため画像を追加しませんでした。現在の会話で選び直してください。');
          }, error => { if (revision === imageRevision.current) setImageError(error instanceof Error ? error.message : '画像を確認できません。'); })
            .finally(() => { if (revision === imageRevision.current) { setImageReading(false); controller.setImageSelecting(false, profile, liveId); } });
        }} />
        {!expanded && <><label className="remote-sr-only" htmlFor="remote-input">Hermesへのメッセージ</label>
        <textarea ref={composer} id="remote-input" value={state.draft} rows={1} placeholder="メッセージを入力…" aria-describedby="remote-composer-hint"
          onFocus={() => { setInputFocused(true); onComposerFocus(true); }} onBlur={() => { rememberSelection(); onComposerFocus(false); }} onSelect={rememberSelection}
          onCompositionStart={() => composition(true)} onCompositionEnd={() => composition(false)}
          onChange={event => { controller.setDraft(event.target.value); rememberSelection(); }} /></>}
        <div ref={composerActions} className="remote-composer-actions">
          <div className="remote-composer-slot">{inputFocused && <button className="remote-dismiss-keyboard" type="button" aria-label="キーボードを閉じる"
            onPointerDown={event => event.preventDefault()} onClick={() => { composer.current?.blur(); setInputFocused(false); onComposerFocus(false); }}><RemoteIcon name="keyboard" /><span>閉じる</span></button>}
            {hasNew && !searchOpen && <button className="remote-new" type="button" aria-label="新着を表示" onClick={() => {
              atBottom.current = true; if (scroller.current) followTail(scroller.current); setHasNew(false);
            }}><RemoteIcon name="down" />新着</button>}
            <button className="remote-composer-help" type="button" aria-label="入力の補助" aria-haspopup="dialog" disabled={isComposing}
              onPointerDown={event => { event.preventDefault(); rememberSelection(); }} onClick={() => { rememberSelection(); setAuxiliary(true); }}><RemoteIcon name="more" /><span>入力の補助</span></button></div>
          <button className="remote-send" aria-label="送信" title={state.delivery === 'sending' ? '送信中' : '送信'} disabled={!sendEnabled} type="submit" onPointerDown={event => {
            // Avoid a blur/reflow between a touch-down and the actual send click.
            if (document.activeElement === composer.current) event.preventDefault();
          }}><RemoteIcon name="send" /></button>
        </div>
        <p id="remote-composer-hint" className="remote-sr-only">改行はEnter。送信は送信ボタンのみ。下書きはこの画面のメモリのみです。実行中の追加入力は下書きに留めます。</p>
      </form>
    </div>
    {attachmentDetails?.scope === scope && attachmentDetails.identity === attachmentIdentity && attachmentDetails.kind === 'image' && state.attachment
      && <AttachmentDetails kind="image" image={state.attachment} capabilities={state.imageCapabilities} rawLimit={controller.imageLimit}
        localOnly={!controller.imageTransferAvailable} onDismiss={() => setAttachmentDetails(null)}
        onCancel={() => { void controller.cancelImage(); setAttachmentDetails(null); }} />}
    {attachmentDetails?.scope === scope && attachmentDetails.identity === attachmentIdentity && attachmentDetails.kind === 'document' && state.document
      && <AttachmentDetails kind="document" document={state.document} capabilities={state.documentCapabilities} rawLimit={controller.documentLimit}
        localOnly={!controller.documentTransferAvailable} onDismiss={() => setAttachmentDetails(null)}
        onCancel={() => { controller.cancelDocument(); setAttachmentDetails(null); }} />}
    {auxiliary && <ConfirmDialog label="入力の補助" className="remote-sheet" actionNavigation dismissOnBackdrop onDismiss={() => setAuxiliary(false)}>
      <div className="remote-sheet-heading"><h2>入力の補助</h2><button autoFocus data-dialog-initial-focus onClick={() => setAuxiliary(false)}>閉じる</button></div>
      <button className="remote-menu-action" disabled={isComposing} onClick={() => { if (!composing.current) { setAuxiliary(false); setExpanded(true); } }}>入力欄を広げる</button>
      {onFeature && state.featureMethods?.includes('remote.templates.list') && <button className="remote-menu-action" disabled={isComposing} onClick={() => { setAuxiliary(false); onFeature('templates'); }}>個人用定型文</button>}
      {onFeature && <button className="remote-menu-action" disabled={isComposing} onClick={() => { setAuxiliary(false); onFeature('voice'); }}>音声入力・読み上げ</button>}
      {!controller.imageTransferAvailable && !state.imageDiagnostic && <p className="remote-meta" role="status">端末内プレビューのみ・画像送信は未対応。画像解析対応は未確認です。</p>}
      {state.imageDiagnostic && <p className="remote-meta" role="status">{state.imageDiagnostic}</p>}
      {state.attachment && <p className="remote-meta">選択した画像: {state.attachment.name} · {state.attachment.width}×{state.attachment.height}px</p>}
      <button className="remote-menu-action" disabled={isComposing || Boolean(state.attachment) || Boolean(state.document) || imageReading} onClick={() => { setAuxiliary(false); fileInput.current?.click(); }}>画像を追加</button>
      <p className="remote-meta">JPEG/PNGを1枚 · 端末内上限{(controller.imageLimit / 1048576).toFixed(2)}MiB · 各辺{state.imageCapabilities?.max_edge ?? 8192}px・{Math.floor((state.imageCapabilities?.max_pixels ?? 16000000) / 10000)}万画素。生成先の上限は送信直前にも検証します。短い説明文が必要です。</p>
      <button className="remote-menu-action" disabled={isComposing || Boolean(state.attachment) || Boolean(state.document) || imageReading} onClick={() => { setAuxiliary(false); documentInput.current?.click(); }}>資料を追加</button>
      {!controller.documentTransferAvailable && <p className="remote-meta" role="status">端末内プレビューのみ・資料送信は未対応または生成が未許可です。</p>}
      <p className="remote-meta">TXT/Markdown/CSV/PDF 1つ · raw上限{(controller.documentLimit / 1048576).toFixed(2)}MiB · 抽出{documentLimit.extractedBytes / 1024}KiB・PDF最大{documentLimit.pages}頁。資料も短い説明本文と同じ送信で受け付けます。</p>
      <details><summary>画像の扱い</summary><p className="remote-meta">選択だけでは転送しません。メタデータは除去していません。転送後はVPSに画像が残り得ます。生成時にはproviderへ渡ります。「添付を外す」は端末内の選択を外す操作です。送信後のVPS原本削除は保証しません。</p></details>
      <h3>定型文</h3>{QUICK_TEXTS.map(template => <button key={template.label} className="remote-quick-text" onClick={() => {
        const inserted = insertQuickText(state.draft, template.text, selection.current?.start);
        controller.setDraft(inserted.draft); selection.current = { start: inserted.caret, end: inserted.caret };
        setAuxiliary(false); restoreComposer();
      }}><strong>{template.label}</strong><span>{template.text}</span></button>)}
      <p className="remote-meta">下書きへ挿入するだけで送信しません。「調査のみ」は文章テンプレートで、ツール権限や安全性を変更しません。</p>
    </ConfirmDialog>}
    {expanded && <ExpandedEditor draft={state.draft} selection={selection} composing={isComposing} onComposition={composition} onDraft={value => controller.setDraft(value)}
      onDismiss={() => { if (!composing.current) { setExpanded(false); restoreComposer(); } }} />}
  </section>;
}
