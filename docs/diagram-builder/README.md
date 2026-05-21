# diagram-builder

PlantUML SVG batch generator. For every class in `data/versions/<version>/classes.json` it
extracts the 2-hop BFS subgraph from `relations.json`, emits a PlantUML source, and renders
an interactive (clickable) SVG with `plantuml.jar`.

The SVGs are consumed by the viewer (Phase 2). They live under
`viewer/public/diagrams/<version>/` and are NOT committed to git — generate locally.

## Prerequisites

- Java 11+ (`java -version`) — for `plantuml.jar`
- Node.js 18+ (`node --version`)
- ~600 MB free disk for the v6u3 output

No `graphviz`/`dot` install is required: the script uses PlantUML's pure-Java `smetana`
layout via `!pragma layout smetana`.

## Install

```bash
cd tools/diagram-builder
npm install

# plantuml.jar is gitignored — download once
curl -L -o plantuml.jar \
  https://github.com/plantuml/plantuml/releases/download/v1.2024.4/plantuml-1.2024.4.jar
```

## Usage

```bash
# 10-class smoke test (≈15 s on an 8-core box)
npm run sample

# Full v6u3 build (2127 classes, ≈6–7 min on an 8-core box)
npm run build

# Other knobs
node build-diagrams.js \
  --version=v6u3 \      # version under data/versions/
  --limit=100 \         # cap target classes (0 = all)
  --concurrency=8 \     # parallel JVMs
  --max-nodes=25 \      # subgraph node cap (smetana scales badly above this)
  --depth=2 \           # BFS hops from the centre class
  --only=fully.qualified.Name  # render exactly one diagram (debugging)
```

Output: `viewer/public/diagrams/<version>/<URL-encoded-FQCN>.svg`.

Failures (if any) are written to `_failures.json` in the output directory.

## Subgraph extraction

For each class `C` we collect:

1. `C` itself at depth 0 (rendered with full fields/methods, light-yellow background).
2. Neighbours reachable through up to `--depth` hops in `relations.json`, in either
   direction. We walk a union of out- and in-edges so callers and dependees both appear.
3. The traversal is **capped at `--max-nodes` (default 25)**. When a level produces more
   candidates than fit, we keep edges by priority: `EXTENDS / IMPLEMENTS` first, then
   `CONTAINS`, then `USES`, then `DEPENDS`. This keeps inheritance hierarchies intact and
   trims noise (typically the `*DEPENDS*` long tail).

Within the subgraph every distinct `(from, relation_type, to)` triple is drawn once:

| classes.json `relation_type` | PlantUML arrow | Notes |
|------------------------------|----------------|-------|
| EXTENDS                      | `<\|--`        | parent ← child |
| IMPLEMENTS                   | `<\|..`        | interface ← class |
| CONTAINS                     | `o--`          | aggregation |
| USES                         | `..>` (label `uses`) | dependency |
| DEPENDS                      | `..>` (label `depends`) | dependency |

## Clickable links

Each class box embeds `[[ /viewer/?module=<artifactId>&class=<FQCN> ]]`. PlantUML emits
this as a real `<a xlink:href="…">` in the SVG, so the viewer can wire up navigation by
mounting the SVG inline (e.g. `<object>` or `srcdoc`-iframe).

## Performance notes (8-core, JDK 17, smetana)

| Run                | Wall time | Avg / diagram |
|--------------------|-----------|---------------|
| `--limit=10`       | 14.6 s    | 1.46 s |
| Full v6u3 (2127)   | ≈ 6–7 min | 0.18 s wall (8-way) |

If you raise `--max-nodes` past ~40 you'll see smetana time grow super-linearly. If you
need denser diagrams, install `graphviz` and drop the `!pragma layout smetana` line.

## Output layout

```
viewer/public/diagrams/
  v6u3/
    nablarch.fw.web.handler.HttpResponseHandler.svg
    nablarch.core.repository.SystemRepository.svg
    …
    _failures.json   # written only when at least one diagram failed
```

Sample SVGs for PR review are committed under
`docs/diagram-builder/samples/` so reviewers can inspect them without running the build.
