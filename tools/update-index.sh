#!/bin/bash
# Scan data/versions/ and regenerate data/versions/index.json from each meta.json

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DATA_DIR="$SCRIPT_DIR/../data/versions"
INDEX_FILE="$DATA_DIR/index.json"

if [ ! -d "$DATA_DIR" ]; then
  echo "Error: data/versions/ directory not found: $DATA_DIR" >&2
  exit 1
fi

versions_json="["
first=1

for meta_file in "$DATA_DIR"/*/meta.json; do
  [ -f "$meta_file" ] || continue

  version=$(grep '"nablarch_version"' "$meta_file" | sed 's/.*: *"\(.*\)".*/\1/')
  analyzed_at=$(grep '"analyzed_at"' "$meta_file" | sed 's/.*: *"\(.*\)".*/\1/')
  total_classes=$(grep '"total_classes"' "$meta_file" | grep -o '[0-9]*')
  status=$(grep '"status"' "$meta_file" | sed 's/.*: *"\(.*\)".*/\1/')

  [ -z "$version" ] && continue
  [ "$status" = "done" ] || [ "$status" = "failed" ] || continue

  if [ $first -eq 0 ]; then
    versions_json="$versions_json,"
  fi
  versions_json="$versions_json
    {
      \"version\": \"$version\",
      \"analyzed_at\": \"$analyzed_at\",
      \"total_classes\": $total_classes,
      \"status\": \"$status\"
    }"
  first=0
done

versions_json="$versions_json
  ]"

cat > "$INDEX_FILE" <<EOF
{
  "versions": $versions_json
}
EOF

echo "index.json updated: $INDEX_FILE"
grep '"version"' "$INDEX_FILE" | sed 's/.*"version": *"\(.*\)".*/  - \1/'
