# AGETNT.md

このファイルは、AzDoDeck リポジトリで作業するエージェント向けのガイドです。

## プロジェクト概要

AzDoDeck は Azure DevOps の pull request、work item、commit などを横断して閲覧するためのデスクトップダッシュボードです。Tauri 2、React、TypeScript、Rust workspace で構成されています。

現在は pre-release の初期開発段階です。既存の実装は最小限なので、変更時は将来の拡張に耐える小さく明確な単位で進めてください。

## 主な構成

- `src/`: React/Vite フロントエンド
- `src-tauri/`: Tauri アプリ本体
- `crates/azdo-client/`: Azure DevOps REST client 用 Rust crate
- `public/`: 静的アセット
- `docs/`: 設計メモや補助ドキュメント

## 開発コマンド

```sh
pnpm install
pnpm dev
pnpm build
pnpm test
pnpm tauri dev
cargo test --workspace
cargo fmt --all
```

## 実装方針

- フロントエンドは React 19、TypeScript、Tailwind CSS の既存構成に合わせます。
- UI では `lucide-react` が使えるため、アイコンが必要な場合は優先して利用します。
- Tauri コマンドや OS 連携は `src-tauri/` 側に閉じ込め、フロントエンドとは明確な境界を保ちます。
- Azure DevOps API との通信ロジックは `crates/azdo-client/` に寄せます。
- API レスポンスや設定値などの外部入力は、TypeScript 側では `zod`、Rust 側では型と `serde` を使って明示的に扱います。
- 既存のプレースホルダー実装を大きく置き換える場合でも、関連するテストを同時に更新します。

## テストと検証

変更の種類に応じて、以下を実行してください。

- フロントエンドのみ: `pnpm test`、必要に応じて `pnpm build`
- Rust crate または Tauri 側: `cargo test --workspace`
- Tauri 統合やデスクトップ挙動: `pnpm tauri dev`

ビルドやテストを実行できなかった場合は、理由と未検証の範囲を作業報告に明記してください。

## 注意点

- Windows 10/11 を前提にしたデスクトップアプリです。
- Node.js は 20 以上、pnpm は 11 以上を想定しています。
- Rust workspace の `rust-version` は 1.80 です。
- ユーザーの未コミット変更は勝手に戻さないでください。
- ロックファイルは依存関係を変更した場合のみ更新してください。

