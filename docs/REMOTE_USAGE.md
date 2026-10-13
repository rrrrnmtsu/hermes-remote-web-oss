# Daily use

[Install and verify first](OSS_INSTALL.md). The interface is currently Japanese;
English UI is a roadmap milestone. Safari and home-screen authentication are
separate acceptance checks. There is no default server credential/origin.

1. Open the dedicated same-origin path and authenticate through the existing
   Dashboard. Verify connected/read-RPC state in Settings; HTTP 200 alone is not
   connected and generation permission does not prove provider success.
2. Use the sidebar to select a registered profile/project and a conversation.
   A displayed page is the fetched scope, not every profile or all history.
3. Write in the memory composer. Enter inserts a line break; send explicitly.
   The **＋** button (“入力の補助”) offers expanded input, fixed templates and local attachments.
   Selection, preview, quotation and template insertion do not send.
   Short drafts share one rounded row with the controls; longer drafts grow to a
   bounded scrollable editor. At 200% text size the editor uses the full width.
   The keyboard icon dismisses editing without clearing the draft. The disabled
   send state remains authoritative; “理由” opens the server's explanation.
4. The message menu offers “引用して質問”. Conversation menu contains loaded-body
   search and bounded Markdown save. Search index/query and draft stay in memory.
   Saving a Markdown file deliberately leaves conversation text on the device.
5. Review the target of real server approval/clarify cards. Unknown send/answer/stop
   results require read-only reconciliation, never automatic resend. A stop ACK
   does not prove completion or undo prior actions.
6. Accept updates explicitly only when the app permits it. Keep drafts/runs and
   unresolved requests; a new static release never forcibly reloads another tab.

Body-size setting supports 15/16/17px, with 16px default/reset. Encrypted storage,
offline shell, notifications and microphone/speech require explicit choice. Default
memory drafts are lost when the page is destroyed; no complete recovery is claimed.

For fast movement, choose **クイックナビゲーション** from the sidebar or Settings,
or press Command/Control+K with a hardware keyboard. Search destination names in
Japanese or English, then explicitly select a result. This only navigates/opens
existing read panels; it never sends, answers, stops, saves or enables consent.
The query stays in memory. [Quick navigation details](QUICK_NAVIGATION.md).

For messaging-bot conversations, open **設定 → ボットの状態を開く** (also in quick
navigation). **会話一覧を取得** and **次の50件を取得** explicitly load up to four
owned pages for the selected profile/project. The bot selector and title search
only filter the loaded range; older source evidence may be unavailable. A row
opens only on your click, after existing draft/run/unknown-send checks. The panel
does not send a bot message, change its settings or start/stop a process.
[Meaning of counts, source evidence and limits](BOT_OVERVIEW.md).

For a support report, Settings → “導入と対応機能” → review the allowlisted diagnostic
text → explicitly copy. Share build/stage/boolean information and synthetic
reproduction steps, not actual conversation, session identifiers, origins, images,
raw logs, cookies, tickets or keys. See [SECURITY.md](../SECURITY.md) for private
vulnerability reporting and [privacy](SECURITY.md) for each storage boundary.

会話中の更新案内は右上の「…」の印から、会話メニュー →「アプリの更新を確認」で開きます。更新操作は下書き・実行・確認待ちがない場合にだけ利用できます。設定画面の更新操作も引き続き使えます。自動再読み込みはしません。
