# nablarch-class-visualizer

Nablarch フレームワークのクラス関係を可視化するインタラクティブツールです。

## プロジェクト概要

Nablarch は118リポジトリ（本番 Java ソースを持つもの92件）に分散したフレームワークです。2,127件の型宣言（クラス・インタフェース・列挙型）を持ち、全体のクラス関係を把握することは容易ではありません。

本ツールは **PlantUML × ASM** を技術基盤とし、継承・実装・依存といったクラス間の関係を UML クラス図としてブラウザ上でインタラクティブに探索できる環境を提供します。

---

## クイックスタート

### 前提条件

| ツール | バージョン |
|-------|-----------|
| Java | 11 以上 |
| Node.js | 18 以上 |
| Maven | 3.8 以上 |

### 1. クラス図を生成する

```bash
# plantuml.jar を一度だけダウンロード
cd tools/diagram-builder
curl -L -o plantuml.jar \
  https://github.com/plantuml/plantuml/releases/download/v1.2024.4/plantuml-1.2024.4.jar

# 依存関係インストール
npm install

# 全クラス図を生成（v6u3, 2127クラス, 約6〜7分）
npm run build

# 動作確認用 10クラスのみ生成（約15秒）
npm run sample
```

出力先: `viewer/public/diagrams/v6u3/<FQCN>.svg`

> **注意**: 生成された SVG ファイル群（約600MB）は `.gitignore` により Git 管理外です。
> ローカルに残り続けるため、**一度生成すれば次回以降は不要**です。
> Nablarch のバージョンを新たに解析した場合や `viewer/public/diagrams/` を削除した場合に再実行してください。

その他のオプション:

```bash
node build-diagrams.js \
  --version=v6u3 \      # data/versions/ 配下のバージョン名
  --limit=100 \         # 生成するクラス数の上限（0 = 全件）
  --concurrency=8 \     # 並列 JVM 数
  --max-nodes=25 \      # サブグラフのノード上限
  --depth=2 \           # フォーカスクラスからの BFS ホップ数
  --only=com.example.MyClass  # 1クラスのみ生成（デバッグ用）
```

### 2. Viewer を起動する

```bash
# viewer をビルド（クラス図生成後に実行）
cd viewer
npm install
npm run build

# ポート 5000 で起動（バックグラウンド）
nohup npx serve dist -p 5000 --no-clipboard > /tmp/nablarch-serve.log 2>&1 &
```

ブラウザで http://localhost:5000/ を開きます。

**停止方法:**

```bash
pkill -f "serve dist"
```

**ログ確認:**

```bash
cat /tmp/nablarch-serve.log
```

---

## 設計文書一覧

| ドキュメント | 内容 |
|------------|------|
| [docs/requirements.md](docs/requirements.md) | 要件定義書 — ユーザーストーリー・機能要件・非機能要件 |
| [docs/architecture.md](docs/architecture.md) | アーキテクチャ設計書 — 解析パイプライン・フロントエンド構成・デプロイオプション |
| [docs/data-schema.md](docs/data-schema.md) | データスキーマ定義書 — JSON ファイル形式の詳細仕様 |
| [docs/implementation-plan.md](docs/implementation-plan.md) | 実装計画書 — Phase 1〜4 のスコープ・工数・検証基準 |
| [docs/risks.md](docs/risks.md) | リスク管理表 — 技術リスクと対策 |
| [docs/startup.md](docs/startup.md) | 起動手順詳細 |
| [docs/diagram-builder/README.md](docs/diagram-builder/README.md) | diagram-builder 詳細ドキュメント |

## 技術スタック

| コンポーネント | 技術 |
|------------|------|
| クラス図生成 | [PlantUML](https://plantuml.com/) — smetana レイアウト（Graphviz 不要） |
| クラス解析 | ASM 9.x（バイトコードレベル解析） |
| フロントエンド | React + Vite |
| SVG ビューア | インライン SVG + DiagramViewer コンポーネント |

## フェーズ計画概要

| フェーズ | 内容 | 状態 |
|--------|------|------|
| **Phase 1** | PoC — 単一バージョン・コア可視化（ASM解析 + React描画） | ✅ 完了 |
| **Phase 2** | バージョン管理 — 複数バージョン切り替え | ✅ 完了 |
| **Phase 3** | フル探索 UI — N段階展開・全フィルタ・LOD | ✅ 完了 |
| **Phase 4** | チーム配布 — Docker コンテナ化（オプション） | 未着手 |

詳細は [docs/implementation-plan.md](docs/implementation-plan.md) を参照してください。

## ライセンス

MIT License — 詳細は [LICENSE](LICENSE) を参照してください。
