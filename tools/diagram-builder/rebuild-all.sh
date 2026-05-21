#!/bin/bash
# SVG一括再生成 → npm run build の一気通貫スクリプト
# 使用方法: bash rebuild-all.sh
set -e
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
VIEWER_DIR="$SCRIPT_DIR/../../viewer"

echo "[1/2] SVG全再生成開始..."
node "$SCRIPT_DIR/build-diagrams.js" --mode=batch
echo "[1/2] SVG全再生成完了"

echo "[2/2] npm run build 開始..."
cd "$VIEWER_DIR"
npm run build
echo "[2/2] npm run build 完了。dist/diagrams/ 反映済み。"
