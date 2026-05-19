# nablarch-class-visualizer

Nablarch フレームワークのクラス関係を可視化するインタラクティブツールです。

## プロジェクト概要

Nablarch は118リポジトリ（本番 Java ソースを持つもの92件）に分散したフレームワークです。2,681件の型宣言（クラス・インタフェース・列挙型）を持ち、全体のクラス関係を把握することは容易ではありません。

本ツールは **Cytoscape.js × ClassGraph** を技術基盤とし、継承・実装・依存といったクラス間の関係をブラウザ上でインタラクティブに探索できる環境を提供します。

## 設計文書一覧

| ドキュメント | 内容 |
|------------|------|
| [docs/requirements.md](docs/requirements.md) | 要件定義書 — ユーザーストーリー・機能要件・非機能要件 |
| [docs/architecture.md](docs/architecture.md) | アーキテクチャ設計書 — 解析パイプライン・フロントエンド構成・デプロイオプション |
| [docs/data-schema.md](docs/data-schema.md) | データスキーマ定義書 — JSON ファイル形式の詳細仕様 |
| [docs/implementation-plan.md](docs/implementation-plan.md) | 実装計画書 — Phase 1〜4 のスコープ・工数・検証基準 |
| [docs/risks.md](docs/risks.md) | リスク管理表 — 技術リスクと対策 |

## 技術スタック

| コンポーネント | 技術 |
|------------|------|
| グラフ描画 | [Cytoscape.js](https://cytoscape.org/) — MIT ライセンス |
| レイアウトエンジン | cytoscape-fcose プラグイン |
| クラス解析 | [ClassGraph](https://github.com/classgraph/classgraph) |
| フロントエンドビルド | Vite + Vanilla JS（Phase 1〜3） |
| デプロイ | 静的ファイル配布（PoC）/ Docker（チーム配布） |

## フェーズ計画概要

| フェーズ | 内容 | 想定期間 |
|--------|------|---------|
| **Phase 1** | PoC — 単一バージョン・コア可視化（ClassGraph解析 + Cytoscape.js描画） | 1〜2週間 |
| **Phase 2** | バージョン管理 — 複数バージョン切り替え・解析起動 UI | 1〜2週間 |
| **Phase 3** | フル探索 UI — N段階展開・全フィルタ・LOD | 2〜3週間 |
| **Phase 4** | チーム配布 — Docker コンテナ化（オプション） | 約4日 |

詳細は [docs/implementation-plan.md](docs/implementation-plan.md) を参照してください。

## 判断待ち事項

実装前に確認が必要な設計判断事項があります。詳細は [questions.md](questions.md) を参照してください。

- **Q-VIZ-01**: 初期俯瞰の簡略化方針（パッケージグループ化 / アーティファクトグループ化 / LOD / フィルタ前提）
- **Q-VIZ-02**: デプロイ形態の希望（静的配布 / バックエンドサーバー / Docker）
- **Q-VIZ-03**: 描画優先関係性（EXTENDS+IMPLEMENTS のみ / DEPENDS 追加 / 全関係性）
- **Q-VIZ-04**: PoC 開始タイミング
- **Q-VIZ-05**: その他（ClassGraph vs ASM / UIフレームワーク / テストクラスの含む/含まない）

## ライセンス

MIT License — 詳細は [LICENSE](LICENSE) を参照してください。
