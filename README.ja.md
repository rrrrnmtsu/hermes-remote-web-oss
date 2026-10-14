# Hermes Remote Web

既存Hermesをスマホから操作するための、非公式・セルフホスト用Webクライアントです。
初回公開は **Developer Preview**。日本語UI、日英文書、1所有者、同一origin、
前景1会話を対象にします。

[English](README.md) · [導入](docs/OSS_INSTALL.md) ·
[互換表](compatibility.json) · [ロードマップ](docs/OSS_ROADMAP.md)

## レビュワー向けガイド

**由来:** 本リポジトリは派生物であり、ゼロから作った/clean-roomの実装ではありません。
MIT の [stasstepv/hermes-pwa](https://github.com/stasstepv/hermes-pwa)（`7dc780b`）を出発点とし、
MIT の Hermes Agent `apps/shared`（`e8c9732`）も取り込んでいます。
[NOTICE](NOTICE)、`upstream.lock.json`、`THIRD_PARTY_NOTICES.md` を参照してください。
公開履歴は squash した1コミット（`66322cf`）から始まり、それ以前の非公開履歴は含みません。
そのため、これ以前の行ごとの作者はGitから示せません。以降の変更はPR #1〜#9です。
Gitからは、人が書いた行とAIツールが書いた行は区別できません。

**テストで読む代表的な判断3つ**（`packages/core/src/stores/remote-product.test.ts`）:

1. *送信結果が不明なときは再送しない。* 返答が失われても下書きを残し、復旧や連打で再送しない（二重送信を防ぐ）。
2. *資料が拒否されてもテキストだけで再送しない。* 下書きと資料の選択を残す（添付が黙って落ちるのを防ぐ）。
3. *serverが生成を許可していなければ生成を呼ばない。* `prompt.submit` は呼ばず、読み取りだけ動く。

**読む順番:** `compatibility.json` → `remote-product.test.ts` → 確認したいコミットのCI（Actionsの "OSS verification"）。
過去には失敗した実行（`66322cf`、PR #1で修正）や取消（`a69e69d`）もあり、以降のコミットは成功しています。

**未検証:** 実機iPhone（Safari/ホーム画面）と実providerでの生成は、`compatibility.json` で `NOT_RUN` です。
自動試験は合成gatewayによるもので、これらを証明しません。

## 機能と受入れ

profile/project/会話、Markdownとコードコピー、明示送信、本物の承認・追加質問・取消、
停止・再接続/replay、引用、取得済み本文の検索、拡大入力、定型文、Markdown保存を持ちます。
画像/資料の詳細、正式成果物・ファイル、会話モデルはserverの能力と方針で制限されます。

サイドバー・設定、または⌘ / Ctrl + Kから [クイックナビゲーション](docs/QUICK_NAVIGATION.md) を開き、
既存の画面・閲覧パネルへ移動できます。日本語・英語の名前で検索でき、選択だけで送信・承認は行いません。

暗号化下書き/履歴、専用静的worker、通知、端末音声、別originは任意です。
本人の同意を代行しません。native iOSはソース段階で、コンパイル/署名済みアプリとして配布しません。

code・unit・合成providerを使う実Gateway試験・実生成・実iPhoneを分けます。
実provider生成、画像解析、実機ロック復帰の合格は、この公開だけでは宣言しません。

## 導入の条件

全機能は [互換表](compatibility.json) にある固定backendと追加契約を対象にします。
静的UIの配置はbackendの更新ではありません。必要な差分を導入者が確認し、別操作で扱います。
追加契約のないserverでは対応する読み取りだけを提供し、新版から生成しません。

既存Dashboardと同じHTTPS originの `/hermes-remote-web/` へ配布します。
Hermesの既存認証・API/WSS・Host/Origin・他経路を維持します。
新規のLLM実行エンジン、会員DB、認証サービスを追加しません。

Node 24.18.0と固定lockfileを使います。

~~~sh
npm ci --ignore-scripts --no-audit --no-fund
npm run typecheck
npm run lint
npm test -- --maxWorkers=1 --minWorkers=1
npm run build
npm run verify:pwa
npm run verify:pack
~~~

生成された `releases/<build-id>/` を使います。
汎用の導入確認・準備・静的切替・復旧は [導入ガイド](docs/OSS_INSTALL.md) にまとめます。
既定はdry-runです。本番再起動・設定変更・実送信は導入処理に含めません。

## 保存・診断

既定では本文・下書き・ID・検索語・添付・ticketを端末へ平文保存しません。
表示設定、明示保存、opt-in暗号化領域などの範囲は [Privacy](docs/SECURITY.md) を参照します。
サニタイズ診断は許可された版・段階・能力の項目だけを明示操作で作り、
秘密値・origin・profile名・会話本文は含めません。

## ライセンス

MITの派生版で、元の著作権・来歴を維持します。公式共有コードを取り込んでいるため
clean-roomとは表現しません。Nous Researchの公式製品ではありません。
[第三者の条件](THIRD_PARTY_NOTICES.md) を確認してください。
個人用運用記録・権利未確認の旧画像を公開成果物へ入れません。

固定backendの再構築と適用境界は [Backend preparation](docs/BACKEND_PREVIEW.md) に記載しています。静的ツールはbackendを適用・再起動しません。

## 合成データの画面

WebKitで公開候補を実表示したDEMO画像です。実provider生成・実iPhoneの証拠ではありません。

[会話画面](docs/screenshots/conversation.png) · [導入案内とサニタイズ診断](docs/screenshots/setup-diagnostics.png)
