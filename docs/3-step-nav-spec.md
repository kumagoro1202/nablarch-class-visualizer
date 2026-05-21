# 3階層ナビゲーションUI 仕様書

## 概要

Nablarchクラスビューアの3階層ナビゲーションUI。PlantUML生成SVGを活用したクラス図ブラウザ。

## 画面構成

```
画面1: モジュール一覧 (/)
  └→ 画面2: パッケージ階層クラス一覧 (?module=...)
       └→ 画面3: SVGクラス図ビューア (?module=...&class=...)
```

## URLルーティング

自前実装（react-routerなし）。`URLSearchParams` + `history.pushState`。

| URL形式 | 表示画面 |
|---------|---------|
| `/` | モジュール一覧 |
| `/?module={artifactId}` | パッケージ階層クラス一覧 |
| `/?module={artifactId}&class={fqcn}` | SVGクラス図 |

ブラウザバックは `popstate` イベントで対応。

## 画面1: モジュール一覧 (ModuleList)

**データソース**: `/data/versions/{version}/classes.json` の `nodes[].artifactId` を集計

**機能**:
- モジュール名テキスト検索
- 主要モジュール（ピン留め）上位表示: nablarch-fw, nablarch-fw-web 等
- 全モジュール一覧（クラス数降順）
- カードクリックで画面2へ遷移

## 画面2: パッケージ階層クラス一覧 (ClassListByPackage)

**データソース**: classes.json の `nodes[].package` / `nodes[].simpleName` / `nodes[].type`

**機能**:
- パッケージ単位でグループ化、展開/折りたたみ
- クラス名テキスト検索
- クラス型バッジ表示（C: Class / I: Interface / E: Enum）
- クラス名クリックで画面3へ遷移
- 「← モジュール一覧に戻る」ナビゲーション

## 画面3: SVGクラス図ビューア (DiagramViewer)

**データソース**: `/diagrams/{version}/{encodeURIComponent(fqcn)}.svg`

**機能**:
- マウスホイールズーム / ドラッグパン（react-zoom-pan-pinch）
- SVG内クラス名クリックで他クラス図へジャンプ
  - SVGのアンカーリンク(`/viewer/?module=X&class=Y`)をインターセプト
  - SPA内遷移として処理（ページリロードなし）
- 「← クラス一覧に戻る」「← モジュール一覧に戻る」ナビゲーション
- SVGが存在しない場合はエラーメッセージ表示

## 技術構成

| 項目 | 内容 |
|------|------|
| フレームワーク | React 19 + Vite |
| SVGパン/ズーム | react-zoom-pan-pinch v4 |
| グラフレンダリング | なし（Cytoscape廃止・SVG直接表示） |
| ルーティング | URLSearchParams自前実装 |
| データ | `/data/versions/{version}/classes.json` |
| SVG | `/diagrams/{version}/{encoded-fqcn}.svg` |

## SVGファイル名規則

PlantUML生成SVGのファイル名: `encodeURIComponent(fqcn) + '.svg'`

- 通常クラス: `nablarch.fw.web.HttpRequest.svg`
- 内部クラス: `nablarch.common.dao.DeferredEntityList%241.svg`（`$` → `%24`）

フェッチ時は二重エンコードを使用（ファイル名の`%`を`%25`に変換）:
```js
const svgUrl = `/diagrams/${version}/${encodeURIComponent(encodeURIComponent(fqcn))}.svg`
```
