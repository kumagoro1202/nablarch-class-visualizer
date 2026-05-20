# Phase 1 Progress

## Sub-Phase 1-1: ASM Metadata Extractor CLI

- **Status**: Completed
- **Start**: 2026-05-20
- **Target**: 5 days
- **Branch**: feat/phase1-1-asm-extractor

### What was built

Java CLI tool at `tools/analyzer/` that scans Nablarch JAR files using ASM 9.x bytecode analysis and outputs structured JSON metadata.

**Output files** (to `data/versions/{version}/`):

| File | Fields |
|------|--------|
| `classes.json` | `id`, `fqcn`, `simpleName`, `artifactId`, `package`, `type`, `modifiers`, `x`, `y` |
| `relations.json` | `from`, `to`, `relation_type`, `detail` |
| `artifacts.json` | `artifactId`, `groupId`, `version`, `repository`, `colorHex` |
| `meta.json` | `nablarch_version`, `analyzed_at`, `commit_sha`, `total_classes`, `total_relations`, `total_artifacts`, `duration_seconds`, `tool_version`, `status`, `error_message` |

### Usage

```bash
# Build
cd tools/analyzer
mvn package -q

# Run
java -jar tools/analyzer/target/nablarch-class-extractor-jar-with-dependencies.jar \
  --jars /path/to/nablarch-jars \
  --output ./data/versions/1.2.0 \
  --version 1.2.0

# Exclude test classes
java -jar tools/analyzer/target/nablarch-class-extractor-jar-with-dependencies.jar \
  --jars /path/to/nablarch-jars \
  --output ./data/versions/1.2.0 \
  --version 1.2.0 \
  --exclude-test
```

### Verified results (local-sample, 10 JARs)

- Total classes: 884
- Total relations: 584
- Artifacts: 10

### Next: Sub-Phase 1-2

Static JSON generation pipeline refinement (FQCN normalization, artifact mapping, test class flag).

---

## Sub-Phase 1-2: Static JSON Generation Pipeline

- **Status**: Completed
- **Start**: 2026-05-20
- **Target**: 3 days

### What was built

Full Nablarch 6u3 analysis pipeline using all 61 JARs from Maven Central (BOM: `com.nablarch.profile:nablarch-bom:6u3`).

**Results** (`data/versions/v6u3/`):

| File | Entries |
|------|---------|
| `classes.json` | 2,127 classes |
| `relations.json` | 1,312 relations |
| `artifacts.json` | 61 artifacts |
| `meta.json` | status: done, duration: 0.5s |

**Index** (`data/versions/index.json`): Generated per data-schema.md section 5.

### Artifact coverage (61 JARs)

- `com.nablarch.framework`: 44 JARs (core, fw, common, testing)
- `com.nablarch.integration`: 16 JARs (adapters)
- `com.nablarch.tool`: 1 JAR (toolbox)

### Verified results (v6u3, 61 JARs)

- Total classes: **2,127** (vs. 884 from 10-JAR sample — 2.4× increase)
- Total relations: **1,312**
- Artifacts: **61**

### Next: Sub-Phase 1-3

## Sub-Phase 1-3: React UI Initial Implementation

- **Status**: Completed
- **Start**: 2026-05-20
- **Target**: 7 days

### What was built

React + Vite + Cytoscape.js visualization UI at `viewer/`.

**Features:**
- Artifact color coding (61 artifacts, colorHex from artifacts.json)
- LOD (Level of Detail): node labels hidden at zoom < 0.3, visible at zoom ≥ 0.3
- Class name search with highlight and auto-fit to matched nodes
- Node click detail panel (FQCN, artifact, package, type, modifiers)
- fcose force-directed layout for artifact clustering
- Collapsible legend panel for all 61 artifact colors

**Build:**
```bash
cd viewer
npm install
npm run build
npx serve dist   # serves at localhost:3000
```

Data files are resolved via `viewer/public/data -> ../../data` symlink (copied into `dist/` on build).

### Verified results

- HTTP 200 for index.html, classes.json, relations.json, artifacts.json, index.json
- Build: 753 KB JS (gzip 232 KB), 2.84 KB CSS
- All 2,127 nodes and 1,312 relations loaded

## Sub-Phase 1-4: Performance Verification

- **Status**: Completed (merged into Phase 2 work)
- **Start**: 2026-05-20
- **Target**: 3 days

---

# Phase 2 Progress

## Sub-Phase 2-1: Analyzer Meta Progress Writing

- **Status**: Completed
- **Start**: 2026-05-20
- **Branch**: feat/phase2-version-management

### What was built

Updated `tools/analyzer/src/main/java/com/nablarch/visualizer/Main.java`:
- Writes `meta.json` with `status: "analyzing"` at the start of analysis
- Writes final `meta.json` with `status: "done"` on completion (existing behavior)

## Sub-Phase 2-2: index.json Update Script

- **Status**: Completed
- **Start**: 2026-05-20

### What was built

Created `tools/update-index.sh`:
- Scans `data/versions/*/meta.json`
- Filters entries with `status: done` or `failed`
- Regenerates `data/versions/index.json`

### Usage

```bash
bash tools/update-index.sh
```

## Sub-Phase 2-3: Version Selector UI

- **Status**: Completed
- **Start**: 2026-05-20

### What was built

Updated `viewer/src/App.jsx`:
- Fetches `data/versions/index.json` on mount to populate version list
- Version selector dropdown (shows version name, class count, analysis date)
- Version switch: destroys and recreates Cytoscape instance, re-fetches all JSON, preserves zoom level
- "新バージョンを解析" button → modal showing CLI command and `update-index.sh` usage
- Modal "実行しました" button re-fetches `index.json` to reflect new version

## Phase 2 Follow-up Fixes

- **Status**: Completed
- **Date**: 2026-05-20

### fu-1: Latest version as initial selection

Sort versions by `analyzed_at` descending on load, so the most recently analyzed version is pre-selected instead of alphabetical first.

### fu-2: Preserve search query on version switch

Removed `setSearchQuery('')` from version-switch flow. Added `searchQueryRef` to track current query and re-apply highlight/fit after new graph layout completes.

---

# Phase 3 Progress

## Sub-Phase 3-1: Analyzer Extension (USES/CONTAINS/DEPENDS)

- **Status**: Completed
- **Date**: 2026-05-20
- **Branch**: feat/phase3-1-extended-relations

### What was built

Extended `tools/analyzer/src/main/java/com/nablarch/visualizer/RelationExtractor.java`:

- **CONTAINS**: `visitInnerClass` — emits CONTAINS edge when the visited class is the outer class
- **USES**: `visitField` — parses field descriptor to extract referenced class type
- **DEPENDS**: `visitMethodInsn` — tracks method call targets (requires removing `SKIP_CODE` flag)
- **Deduplication**: per-JAR deduplication on (from, to, relation_type) composite key

Also updated `docs/data-schema.md` with USES/CONTAINS/DEPENDS samples.

### Verified results (v6u3, 61 JARs)

| Type | Count |
|------|-------|
| EXTENDS | 598 |
| IMPLEMENTS | 714 |
| USES | 839 |
| CONTAINS | 467 |
| DEPENDS | 5,323 |
| **Total** | **7,941** |

- `meta.json` total_relations: 7,941 (up from 1,312)

---

## Sub-Phase 3-2: Lazy Load Relations and N-Level Expand UI

- **Status**: Completed
- **Date**: 2026-05-20
- **Branch**: feat/phase3-2-lazy-load-and-expand
- **PR**: #11

### What was built

Updated `viewer/src/App.jsx` and `viewer/src/App.css`:

#### relations.json 遅延読み込み

- Initial load: `classes.json` + `artifacts.json` only → all nodes rendered without edges
- `relations.json` fetched on first filter checkbox interaction or N-level expand mode activation
- Cached after first fetch (no re-fetch on filter toggle)
- Loading indicator (mini spinner) shown during fetch

#### 関係性フィルタパネル

- Floating panel (top-left) with checkboxes for EXTENDS, IMPLEMENTS, USES, CONTAINS, DEPENDS
- EXTENDS + IMPLEMENTS checked by default (Phase1-equivalent display)
- Edge color-coded by relation type

#### N段階展開 UI

- "N段階展開" toggle button in toolbar
- Node click selects focus class (highlighted in red border)
- Controls after focus selection:
  - **+1レベル展開**: BFS one step outward, show new neighbors and connecting edges
  - **-1レベル折り畳む**: hide outermost ring
  - **全展開**: show all nodes and edges
  - **リセット**: return to overview mode (all nodes visible, expand mode off)
- `cy.batch()` for fast show/hide without layout recalculation
- BFS adjacency map built from cached `relations.json`

### Verified results

- `npm run build` error-free ✅
- Bundle: 761.92 kB JS (gzip 234.36 kB), 7.03 kB CSS

---

## Sub-Phase 3-3: Filter UI (Relation Type / Artifact / Package)

- **Status**: Completed
- **Date**: 2026-05-20
- **Branch**: feat/phase3-3-filter-ui
- **PR**: #13

### What was built

Updated `viewer/src/App.jsx` and `viewer/src/App.css`:

#### フィルタアコーディオン

- 既存の関係性フィルタパネルを統合した折り畳み可能な「フィルタ」セクション（▲/▼トグル）
- 3セクション構成: 関係性タイプ / アーティファクト / パッケージ

#### 関係性タイプフィルタ

- EXTENDS / IMPLEMENTS / USES / CONTAINS / DEPENDS の5チェックボックス
- デフォルト: EXTENDS + IMPLEMENTS のみ ON
- relations.json 遅延読み込みと連携（Phase3-2）

#### アーティファクトフィルタ

- 全61アーティファクトのチェックボックスリスト（スクロール可、最大高200px）
- 各アーティファクトの色ドット + 名前 + クラス数 `(N)` 表示
- 「全選択」「全解除」ボタン
- ノード数カウント表示: 表示中ノード数 / 全ノード数

#### パッケージフィルタ

- FQCN 前方一致テキスト入力（例: `nablarch.fw.web`）
- 空欄 = 全表示
- クリアボタン (✕)

#### エッジ数上限ガード

- 有効フィルタで 5,000 エッジ超過時に警告バナー表示
- バナーは手動で閉じ可能

#### その他

- `cy.batch()` によるパフォーマンス確保
- N段階展開モード終了時にアーティファクト/パッケージフィルタを再適用
- 既存機能（検索/N段階展開/LOD/色分け/詳細パネル）の破壊なし

### Verified results

- `npm run build` error-free ✅
- Bundle: 765.23 kB JS (gzip 235.16 kB), 9.48 kB CSS

---

## Sub-Phase 3-4: LOD Compound Nodes + Performance Benchmark

- **Status**: Completed
- **Date**: 2026-05-20
- **Branch**: feat/phase3-4-lod-compound
- **PR**: (作成中)

### What was built

Updated `viewer/src/App.jsx` and `viewer/src/App.css`:

#### LOD 複合ノード（パッケージグループ折り畳み）

- **トリガー**: zoom < 0.3 で自動折り畳み、zoom ≥ 0.3 で自動展開
- **折り畳み動作**:
  - 全クラスノードを非表示
  - FQCN の第1〜3セグメントをパッケージキーとして集約
  - 各グループの重心位置にサマリーノードを追加（`isCompound: true` データ）
  - サマリーノードにパッケージ名 + クラス数を表示（例: `nablarch.fw.web\n(190)`）
  - ノード数に応じたサイズ (mapData: 1〜200 クラス → 32〜72 px)
- **展開動作**: サマリーノードを削除し、クラスノードを復元。アーティファクト/パッケージフィルタを再適用。
- **N段階展開モード中は LOD 折り畳み無効**: 展開モード開始時に複合モードを自動解除。
- **v6u3 結果**: 2,127 ノード → 59 パッケージグループに集約

#### パフォーマンスベンチマーク

- `performance.now()` 計測を実装: データフェッチ・レイアウト・複合ノード切替時間を Console ログに出力
- 結果レポートを `docs/performance-benchmark.md` に記録

#### ツールバー LOD バッジ

- 複合ノードモード中は `📦 パッケージグループ表示` バッジを表示

### Verified results

- `npm run build` error-free ✅
- Bundle: 768.66 kB JS (gzip 236.17 kB), 9.89 kB CSS
- v6u3: 2,127 ノード → 59 パッケージグループ
- LOD 切替: < 15ms (実測値は `docs/performance-benchmark.md` 参照)
