# Nablarch クラス可視化ツール — データスキーマ定義書

**バージョン**: 1.0  
**作成日**: 2026-05-20

---

## 概要

全ての解析出力は `data/versions/{version}/` 配下に4つの JSON ファイルとして保存されます:

```
data/versions/
├── index.json            ← バージョンインデックス（解析ごとに更新）
└── v5.4.0/
    ├── classes.json      ← ノードデータ（型宣言ごとに1エントリ）
    ├── relations.json    ← エッジデータ（関係性ごとに1エントリ）
    ├── artifacts.json    ← アーティファクトメタデータおよび色割り当て
    └── meta.json         ← 解析メタデータおよびステータス
```

---

## 1. `classes.json`

各型宣言（クラス・インタフェース・列挙型・アノテーション・レコード）を記述します。

### スキーマ

```json
{
  "nodes": [
    {
      "id":          "string",   // 完全修飾クラス名（FQCN）— 一意キー
      "fqcn":        "string",   // id と同値; 明示的なフィールドとして重複定義
      "simpleName":  "string",   // パッケージなしの短いクラス名
      "artifactId":  "string",   // 格納 JAR の Maven artifactId
      "package":     "string",   // パッケージ名（例: "nablarch.fw.web"）
      "type":        "string",   // CLASS | INTERFACE | ENUM | ANNOTATION | RECORD のいずれか
      "modifiers":   ["string"], // 例: ["public", "abstract"]
      "x":           number,     // 事前計算済みレイアウト X 座標（未計算時は null）
      "y":           number      // 事前計算済みレイアウト Y 座標（未計算時は null）
    }
  ]
}
```

### サンプル

```json
{
  "nodes": [
    {
      "id":          "nablarch.fw.web.HttpRequestHandler",
      "fqcn":        "nablarch.fw.web.HttpRequestHandler",
      "simpleName":  "HttpRequestHandler",
      "artifactId":  "nablarch-fw-web",
      "package":     "nablarch.fw.web",
      "type":        "INTERFACE",
      "modifiers":   ["public"],
      "x":           142.5,
      "y":           -88.3
    },
    {
      "id":          "nablarch.fw.web.servlet.ServletExecutionContext",
      "fqcn":        "nablarch.fw.web.servlet.ServletExecutionContext",
      "simpleName":  "ServletExecutionContext",
      "artifactId":  "nablarch-fw-web",
      "package":     "nablarch.fw.web.servlet",
      "type":        "CLASS",
      "modifiers":   ["public"],
      "x":           210.0,
      "y":           -45.1
    },
    {
      "id":          "nablarch.fw.ExecutionContext",
      "fqcn":        "nablarch.fw.ExecutionContext",
      "simpleName":  "ExecutionContext",
      "artifactId":  "nablarch-core",
      "package":     "nablarch.fw",
      "type":        "CLASS",
      "modifiers":   ["public"],
      "x":           180.0,
      "y":           0.0
    }
  ]
}
```

### 補足説明

- `id` と `fqcn` は同値です。どちらの命名規約を使うコンシューマも利用できるよう両フィールドを用意しています。
- `x` および `y` は最初の解析実行後は `null` です。フロントエンドで最初のレイアウト計算を行った後に設定され、後続の読み込みに備えてファイルに保存されます。
- `modifiers` は package-private な型の場合、空配列（`[]`）になることがあります。

---

## 2. `relations.json`

型宣言間の有向関係性を記述します。

### スキーマ

```json
{
  "edges": [
    {
      "from":          "string",  // 起点ノードの FQCN
      "to":            "string",  // 終点ノードの FQCN
      "relation_type": "string",  // EXTENDS | IMPLEMENTS | USES | CONTAINS | DEPENDS のいずれか
      "detail":        "string"   // 任意: 補足情報（例: USES の場合はメソッド名）
    }
  ]
}
```

### 関係性タイプ

| 値 | 意味 | 例 |
|----|------|-----|
| `EXTENDS` | クラスが別クラスを継承 | `FooImpl extends FooBase` |
| `IMPLEMENTS` | クラスがインタフェースを実装 | `FooImpl implements FooInterface` |
| `USES` | フィールド型参照（同一プロジェクト内クラスのみ） | `BarService` のフィールドが `BazRepository` 型 |
| `CONTAINS` | インナークラス / ネストクラス（外部クラス → 内部クラス） | `Outer` が `Outer$Inner` を包含 |
| `DEPENDS` | メソッド呼び出し先（同一プロジェクト内クラスのみ） | `WebFrontController` のメソッドが `ServletExecutionContext` を呼び出す |

### サンプル

```json
{
  "edges": [
    {
      "from":          "nablarch.fw.web.servlet.ServletExecutionContext",
      "to":            "nablarch.fw.ExecutionContext",
      "relation_type": "EXTENDS",
      "detail":        ""
    },
    {
      "from":          "nablarch.fw.web.servlet.ServletExecutionContext",
      "to":            "nablarch.fw.web.HttpRequestHandler",
      "relation_type": "IMPLEMENTS",
      "detail":        ""
    },
    {
      "from":          "nablarch.fw.web.action.WebFrontController",
      "to":            "nablarch.fw.web.servlet.ServletExecutionContext",
      "relation_type": "USES",
      "detail":        ""
    },
    {
      "from":          "nablarch.fw.web.handler.HttpErrorHandler",
      "to":            "nablarch.fw.web.handler.HttpErrorHandler$ErrorCode",
      "relation_type": "CONTAINS",
      "detail":        ""
    },
    {
      "from":          "nablarch.fw.web.action.WebFrontController",
      "to":            "nablarch.fw.web.servlet.ServletExecutionContext",
      "relation_type": "DEPENDS",
      "detail":        ""
    }
  ]
}
```

### 補足説明

- エッジは有向です: `from` → `to`。
- `detail` フィールドは任意であり、空文字列でもかまいません。デバッグやツールチップ表示を目的としており、フィルタリングロジックには使用しません。
- `USES` 関係性は大量のエッジを生成する可能性があります。PoC フェーズでは `EXTENDS` と `IMPLEMENTS` のみを抽出します（Phase 1）。`USES`・`CONTAINS`・`DEPENDS` は Phase 3 で追加されます。

---

## 3. `artifacts.json`

各 Maven アーティファクトとその視覚表現を記述します。

### スキーマ

```json
{
  "artifacts": [
    {
      "artifactId":  "string",  // Maven artifactId
      "groupId":     "string",  // Maven groupId
      "version":     "string",  // 本解析における Maven バージョン
      "repository":  "string",  // GitHub リポジトリ名（例: "nablarch/nablarch-fw-web"）
      "colorHex":    "string"   // このアーティファクトに属するノードの色（例: "#4E79A7"）
    }
  ]
}
```

### サンプル

```json
{
  "artifacts": [
    {
      "artifactId":  "nablarch-fw-web",
      "groupId":     "com.nablarch.framework",
      "version":     "6.0.0",
      "repository":  "nablarch/nablarch-fw-web",
      "colorHex":    "#4E79A7"
    },
    {
      "artifactId":  "nablarch-core",
      "groupId":     "com.nablarch.framework",
      "version":     "6.0.0",
      "repository":  "nablarch/nablarch-core",
      "colorHex":    "#F28E2B"
    },
    {
      "artifactId":  "nablarch-fw-batch",
      "groupId":     "com.nablarch.framework",
      "version":     "6.0.0",
      "repository":  "nablarch/nablarch-fw-batch",
      "colorHex":    "#E15759"
    }
  ]
}
```

### 補足説明

- 色割り当ては決定論的です: アーティファクト名のアルファベット順に Tableau 10 パレットから割り当てます。これにより再実行をまたいで色が安定します。
- JAR 内に `pom.properties` が見つからない場合、`groupId` は `"unknown"` になり、`version` は JAR ファイル名から解析されます。

---

## 4. `meta.json`

バージョンマネージャー UI のための解析メタデータとステータスを保存します。

### スキーマ

```json
{
  "nablarch_version":  "string",    // 解析対象のバージョンタグまたはコミット SHA
  "analyzed_at":       "string",    // ISO 8601 タイムスタンプ（例: "2026-05-20T10:30:00Z"）
  "commit_sha":        "string",    // 解析時点での nablarch メインリポジトリの Git コミット SHA
  "total_classes":     number,      // classes.json の総ノード数
  "total_relations":   number,      // relations.json の総エッジ数
  "total_artifacts":   number,      // artifacts.json の総アーティファクト数
  "duration_seconds":  number,      // 解析パイプラインの実時間（秒）
  "tool_version":      "string",    // 本可視化ツールのバージョン
  "status":            "string",    // queued | cloning | analyzing | generating | done | failed のいずれか
  "error_message":     "string"     // status = "failed" の場合のみ非空
}
```

### サンプル（解析完了）

```json
{
  "nablarch_version":  "v5.4.0",
  "analyzed_at":       "2026-05-20T10:30:00Z",
  "commit_sha":        "a1b2c3d4e5f6...",
  "total_classes":     2681,
  "total_relations":   8432,
  "total_artifacts":   92,
  "duration_seconds":  487,
  "tool_version":      "1.0.0",
  "status":            "done",
  "error_message":     ""
}
```

### サンプル（解析進行中）

```json
{
  "nablarch_version":  "v5.5.0",
  "analyzed_at":       "",
  "commit_sha":        "",
  "total_classes":     0,
  "total_relations":   0,
  "total_artifacts":   0,
  "duration_seconds":  0,
  "tool_version":      "1.0.0",
  "status":            "cloning",
  "error_message":     ""
}
```

---

## 5. `data/versions/index.json`

全ての解析済みバージョンのトップレベルインデックスです。解析が正常完了するたびにアトミックに更新されます。

### スキーマ

```json
{
  "versions": [
    {
      "version":       "string",  // バージョンタグ
      "analyzed_at":   "string",  // ISO 8601 タイムスタンプ
      "total_classes": number,    // バージョンセレクタのドロップダウン表示用
      "status":        "string"   // done | failed
    }
  ]
}
```

### サンプル

```json
{
  "versions": [
    {
      "version":       "v5.4.0",
      "analyzed_at":   "2026-05-20T10:30:00Z",
      "total_classes": 2681,
      "status":        "done"
    },
    {
      "version":       "v5.3.0",
      "analyzed_at":   "2026-04-15T08:00:00Z",
      "total_classes": 2598,
      "status":        "done"
    }
  ]
}
```

---

## 6. 設計上の制約

1. 全 JSON ファイルは BOM なし **UTF-8 エンコーディング** を使用する。
2. 全タイムスタンプは UTC タイムゾーン（`Z` サフィックス）付きの **ISO 8601 フォーマット** を使用する。
3. `classes.json` の `id` フィールドおよび `relations.json` の `from`/`to` フィールドには **FQCN** を主キーとして使用する。これによりアーティファクト間での一意性が保証される。
4. `artifacts.json` の `colorHex` 値は **7文字の16進数文字列**（例: `"#4E79A7"`）であり、CSS 名前付き色ではない。
5. スキーマは新バージョンに対して **追記のみ** となるよう設計されており、既存のバージョンディレクトリを上書きしない。
