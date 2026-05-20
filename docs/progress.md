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

- **Status**: Not started
- **Target**: 7 days

## Sub-Phase 1-4: Performance Verification

- **Status**: Not started
- **Target**: 3 days
