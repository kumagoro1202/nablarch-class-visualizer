#!/usr/bin/env node
// PlantUML SVG batch generator
// For each class in classes.json, build a BFS 2-hop subgraph from relations.json
// and render it to viewer/public/diagrams/{encoded-fqcn}.svg via plantuml.jar.

import { readFile, mkdir, writeFile, rm, stat } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import pLimit from 'p-limit';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const PLANTUML_JAR = path.join(__dirname, 'plantuml.jar');

const argv = process.argv.slice(2);
const getOpt = (name, fallback) => {
  const hit = argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
};
const hasFlag = (name) => argv.includes(`--${name}`);

const VERSION = getOpt('version', 'v6u3');
const LIMIT = Number(getOpt('limit', '0')) || 0; // 0 = all
const CONCURRENCY = Number(getOpt('concurrency', '8')) || 8;
const ONLY_FQCN = getOpt('only', null); // build a single class (for debugging)
const KEEP_PUML = hasFlag('keep-puml'); // keep intermediate .puml
const MAX_NODES = Number(getOpt('max-nodes', '25')) || 25; // cap subgraph for smetana speed/readability
const DEPTH = Number(getOpt('depth', '2')) || 2;
// 'per-class' (default): one JVM per diagram, simpler error attribution.
// 'batch': one JVM processes the whole input directory with -nbthread. Faster on 2000+ runs.
//          Currently opt-in until benchmarked at scale.
const MODE = (getOpt('mode', 'per-class') === 'batch') ? 'batch' : 'per-class';
const OUT_DIR = path.resolve(
  getOpt(
    'out',
    path.join(REPO_ROOT, 'viewer', 'public', 'diagrams', VERSION)
  )
);
const DATA_DIR = path.join(REPO_ROOT, 'data', 'versions', VERSION);

const log = (...a) => console.log(`[diagram-builder]`, ...a);
const errLog = (...a) => console.error(`[diagram-builder]`, ...a);

const fqcnToFile = (fqcn) => encodeURIComponent(fqcn);

// PlantUML reserved characters in entity names: keep quoted identifiers ("..").
const quote = (s) => `"${String(s).replace(/"/g, '\\"')}"`;
const safeAlias = (fqcn) => 'C_' + fqcn.replace(/[^A-Za-z0-9_]/g, '_');

const accessSymbol = (a) => {
  // already in PlantUML form when present, but normalise just in case
  if (a === '+' || a === '-' || a === '#' || a === '~') return a;
  if (a === 'public') return '+';
  if (a === 'private') return '-';
  if (a === 'protected') return '#';
  if (a === 'package') return '~';
  return '~';
};

function nodeKeyword(node) {
  switch (node.type) {
    case 'INTERFACE':
      return 'interface';
    case 'ENUM':
      return 'enum';
    case 'ANNOTATION':
      return 'annotation';
    case 'CLASS':
    default:
      if (node.modifiers?.includes('abstract')) return 'abstract class';
      return 'class';
  }
}

function renderMember(m, kind) {
  const sym = accessSymbol(m.access);
  const mods = [];
  if (m.isStatic) mods.push('{static}');
  if (kind === 'method' && m.isAbstract) mods.push('{abstract}');
  if (kind === 'method') {
    const params = (m.params || [])
      .map((p) => (typeof p === 'string' ? p : `${p.type ?? ''} ${p.name ?? ''}`.trim()))
      .join(', ');
    return `  ${sym} ${mods.join(' ')} ${m.name}(${params}) : ${m.returnType ?? 'void'}`.replace(/\s+/g, ' ');
  }
  return `  ${sym} ${mods.join(' ')} ${m.name} : ${m.type ?? '?'}`.replace(/\s+/g, ' ');
}

function buildAdjacency(edges) {
  const adj = new Map(); // from -> Map<to, Set<rel>>
  for (const e of edges) {
    if (!adj.has(e.from)) adj.set(e.from, new Map());
    const m = adj.get(e.from);
    if (!m.has(e.to)) m.set(e.to, new Set());
    m.get(e.to).add(e.relation_type);
    // also index reverse for BFS
    if (!adj.has(e.to)) adj.set(e.to, new Map());
  }
  return adj;
}

// Relation priority for trimming (lower = keep first)
const REL_PRIORITY = { EXTENDS: 0, IMPLEMENTS: 0, CONTAINS: 1, USES: 2, DEPENDS: 3 };

function edgePriority(adj, u, v) {
  const rels = adj.get(u)?.get(v);
  if (!rels) return 99;
  let best = 99;
  for (const r of rels) best = Math.min(best, REL_PRIORITY[r] ?? 99);
  return best;
}

function bfsNeighbors(center, adjOut, adjIn, depth, maxNodes) {
  // BFS over union of out-edges and in-edges with priority queue per level.
  // Caps total node count to maxNodes, preferring inheritance > containment > uses > depends.
  const visited = new Map([[center, 0]]);
  let frontier = [center];
  for (let d = 1; d <= depth; d++) {
    if (visited.size >= maxNodes) break;
    // Collect candidates (neighbour, priority)
    const candidates = [];
    for (const u of frontier) {
      const outs = adjOut.get(u);
      if (outs) for (const v of outs.keys()) {
        if (!visited.has(v)) candidates.push([v, edgePriority(adjOut, u, v), u, 'out']);
      }
      const ins = adjIn.get(u);
      if (ins) for (const v of ins.keys()) {
        if (!visited.has(v)) candidates.push([v, edgePriority(adjIn, u, v), u, 'in']);
      }
    }
    // Sort by priority asc (EXTENDS first), then deterministic by name
    candidates.sort((a, b) => a[1] - b[1] || a[0].localeCompare(b[0]));
    const next = [];
    const seenThisLevel = new Set();
    for (const [v] of candidates) {
      if (visited.has(v) || seenThisLevel.has(v)) continue;
      if (visited.size >= maxNodes) break;
      visited.set(v, d);
      seenThisLevel.add(v);
      next.push(v);
    }
    frontier = next;
    if (!frontier.length) break;
  }
  return visited;
}

function relationArrow(rel) {
  // PlantUML arrows: extends/implements/depends/uses/contains
  switch (rel) {
    case 'EXTENDS':
      return { arrow: '<|--', label: '' };
    case 'IMPLEMENTS':
      return { arrow: '<|..', label: '' };
    case 'DEPENDS':
      return { arrow: '..>', label: 'depends' };
    case 'USES':
      return { arrow: '..>', label: 'uses' };
    case 'CONTAINS':
      return { arrow: 'o--', label: 'contains' };
    default:
      return { arrow: '-->', label: rel };
  }
}

function generatePuml(centerFqcn, nodesById, adjOut, adjIn, depth, maxNodes) {
  const subgraph = bfsNeighbors(centerFqcn, adjOut, adjIn, depth, maxNodes);
  const lines = [];
  // No name on @startuml so PlantUML uses the input filename for the output SVG.
  lines.push('@startuml');
  // smetana = pure-Java layout, no graphviz/dot required
  lines.push('!pragma layout smetana');
  lines.push(`title ${centerFqcn}`);
  lines.push('skinparam classAttributeIconSize 0');
  lines.push('skinparam packageStyle rectangle');
  lines.push('skinparam backgroundColor white');
  lines.push('skinparam shadowing false');
  lines.push('skinparam linetype ortho');
  lines.push('hide empty members');
  lines.push('');

  // Render nodes
  for (const [fqcn, d] of subgraph.entries()) {
    const node = nodesById.get(fqcn);
    if (!node) {
      // Edge target not in nodes (external dep) → skeleton class
      const kw = 'class';
      const alias = safeAlias(fqcn);
      lines.push(`${kw} ${quote(fqcn)} as ${alias} <<external>>`);
      continue;
    }
    const kw = nodeKeyword(node);
    const alias = safeAlias(fqcn);
    const link = `[[/viewer/?module=${encodeURIComponent(node.artifactId || '')}&class=${encodeURIComponent(fqcn)}]]`;
    const color = d === 0 ? ' #LightYellow' : '';
    lines.push(`${kw} ${quote(fqcn)} as ${alias} ${link}${color} {`);
    if (d === 0) {
      // Show full members for the centre class
      for (const f of node.fields || []) lines.push(renderMember(f, 'field'));
      if ((node.fields || []).length && (node.methods || []).length) lines.push('  ..');
      for (const m of node.methods || []) lines.push(renderMember(m, 'method'));
    }
    lines.push('}');
    if (d === 0) {
      lines.push(`note top of ${alias} : artifact: ${node.artifactId || 'unknown'}`);
    }
  }
  lines.push('');

  // Render edges (only between nodes in subgraph)
  const drawn = new Set();
  for (const u of subgraph.keys()) {
    const outs = adjOut.get(u);
    if (!outs) continue;
    for (const [v, rels] of outs.entries()) {
      if (!subgraph.has(v)) continue;
      for (const rel of rels) {
        const key = `${u}|${rel}|${v}`;
        if (drawn.has(key)) continue;
        drawn.add(key);
        const { arrow, label } = relationArrow(rel);
        const uA = safeAlias(u);
        const vA = safeAlias(v);
        // PlantUML arrow direction: "A <|-- B" means B extends A.
        // Our edge is from=child to=parent for EXTENDS/IMPLEMENTS.
        if (rel === 'EXTENDS' || rel === 'IMPLEMENTS') {
          lines.push(`${vA} ${arrow} ${uA}`);
        } else {
          lines.push(`${uA} ${arrow} ${vA}${label ? ' : ' + label : ''}`);
        }
      }
    }
  }
  lines.push('');
  lines.push('@enduml');
  return lines.join('\n');
}

function runPlantUml(pumlPath, outDir) {
  return new Promise((resolve, reject) => {
    const args = [
      '-Djava.awt.headless=true',
      '-Xmx1024m',
      '-jar', PLANTUML_JAR,
      '-tsvg',
      '-charset', 'UTF-8',
      '-o', outDir,
      pumlPath,
    ];
    const p = spawn('java', args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stderr = '';
    p.stderr.on('data', (d) => { stderr += d.toString(); });
    p.on('error', reject);
    p.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`plantuml exit=${code}: ${stderr.trim()}`));
    });
  });
}

function runPlantUmlBatch(inputDir, outDir, nbThread, heapMb) {
  // One JVM processes every *.puml inside inputDir with internal threading.
  return new Promise((resolve, reject) => {
    const args = [
      '-Djava.awt.headless=true',
      `-Xmx${heapMb}m`,
      '-jar', PLANTUML_JAR,
      '-tsvg',
      '-charset', 'UTF-8',
      '-nbthread', String(nbThread),
      '-o', outDir,
      // PlantUML walks every .puml under this directory.
      inputDir,
    ];
    const p = spawn('java', args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stderr = '';
    p.stderr.on('data', (d) => { stderr += d.toString(); });
    p.on('error', reject);
    p.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`plantuml exit=${code}: ${stderr.trim().slice(0, 2000)}`));
    });
  });
}

async function main() {
  const t0 = Date.now();
  log(`version=${VERSION}, out=${OUT_DIR}, concurrency=${CONCURRENCY}, limit=${LIMIT || 'all'}, depth=${DEPTH}, maxNodes=${MAX_NODES}`);

  // Sanity: plantuml.jar
  try { await stat(PLANTUML_JAR); } catch {
    throw new Error(`plantuml.jar not found at ${PLANTUML_JAR}. Download it first (see README).`);
  }

  const classesPath = path.join(DATA_DIR, 'classes.json');
  const relationsPath = path.join(DATA_DIR, 'relations.json');
  const [classesRaw, relationsRaw] = await Promise.all([
    readFile(classesPath, 'utf8'),
    readFile(relationsPath, 'utf8'),
  ]);
  const classes = JSON.parse(classesRaw);
  const relations = JSON.parse(relationsRaw);
  const nodes = classes.nodes || [];
  const edges = relations.edges || [];
  log(`loaded nodes=${nodes.length}, edges=${edges.length}`);

  const nodesById = new Map(nodes.map((n) => [n.id, n]));
  const adjOut = new Map(); // u -> Map<v, Set<rel>>
  const adjIn = new Map();
  for (const e of edges) {
    if (!adjOut.has(e.from)) adjOut.set(e.from, new Map());
    if (!adjOut.get(e.from).has(e.to)) adjOut.get(e.from).set(e.to, new Set());
    adjOut.get(e.from).get(e.to).add(e.relation_type);
    if (!adjIn.has(e.to)) adjIn.set(e.to, new Map());
    if (!adjIn.get(e.to).has(e.from)) adjIn.get(e.to).set(e.from, new Set());
    adjIn.get(e.to).get(e.from).add(e.relation_type);
  }

  await mkdir(OUT_DIR, { recursive: true });
  const tmpDir = await mkdir(
    path.join(os.tmpdir(), `diagram-builder-${process.pid}`),
    { recursive: true }
  );
  const PUML_DIR = path.join(os.tmpdir(), `diagram-builder-${process.pid}`);

  let targets = nodes.map((n) => n.id);
  if (ONLY_FQCN) targets = [ONLY_FQCN];
  else if (LIMIT > 0) targets = targets.slice(0, LIMIT);

  log(`generating ${targets.length} diagrams ... mode=${MODE}`);

  let ok = 0, fail = 0;
  const failures = [];

  if (MODE === 'batch') {
    // Phase 1: emit all puml files
    const limitGen = pLimit(CONCURRENCY);
    let gen = 0;
    const tPuml = Date.now();
    await Promise.all(targets.map((fqcn) => limitGen(async () => {
      const fileBase = fqcnToFile(fqcn);
      const pumlPath = path.join(PUML_DIR, fileBase + '.puml');
      try {
        const puml = generatePuml(fqcn, nodesById, adjOut, adjIn, DEPTH, MAX_NODES);
        await writeFile(pumlPath, puml, 'utf8');
      } catch (e) {
        fail++;
        failures.push({ fqcn, phase: 'puml', error: String(e.message || e) });
      } finally {
        gen++;
        if (gen % 200 === 0 || gen === targets.length) {
          log(`puml ${gen}/${targets.length} elapsed=${((Date.now() - tPuml) / 1000).toFixed(1)}s`);
        }
      }
    })));
    log(`puml generation done in ${((Date.now() - tPuml) / 1000).toFixed(1)}s`);

    // Phase 2: one JVM, internal nbthread for SVG rendering
    const tSvg = Date.now();
    log(`rendering SVGs with nbthread=${CONCURRENCY} ...`);
    try {
      await runPlantUmlBatch(PUML_DIR, OUT_DIR, CONCURRENCY, 4096);
    } catch (e) {
      errLog(`batch plantuml failed: ${e.message}. Retrying per-class for any missing SVGs.`);
      // Fallback: run per-class for files that are missing
    }
    log(`SVG rendering done in ${((Date.now() - tSvg) / 1000).toFixed(1)}s`);

    // Verify every expected SVG exists, retry per-class for misses
    const stragglers = [];
    for (const fqcn of targets) {
      const svgPath = path.join(OUT_DIR, fqcnToFile(fqcn) + '.svg');
      try {
        const s = await stat(svgPath);
        if (s.size > 0) ok++;
        else stragglers.push(fqcn);
      } catch {
        stragglers.push(fqcn);
      }
    }
    if (stragglers.length) {
      log(`retrying ${stragglers.length} stragglers per-class ...`);
      const limitRetry = pLimit(CONCURRENCY);
      let retried = 0;
      await Promise.all(stragglers.map((fqcn) => limitRetry(async () => {
        const pumlPath = path.join(PUML_DIR, fqcnToFile(fqcn) + '.puml');
        const svgPath = path.join(OUT_DIR, fqcnToFile(fqcn) + '.svg');
        try {
          await runPlantUml(pumlPath, OUT_DIR);
          await stat(svgPath);
          ok++;
        } catch (e) {
          fail++;
          failures.push({ fqcn, phase: 'retry', error: String(e.message || e) });
          errLog(`FAIL retry ${fqcn}: ${e.message || e}`);
        }
        retried++;
        if (retried % 50 === 0 || retried === stragglers.length) {
          log(`retry ${retried}/${stragglers.length}`);
        }
      })));
    }
  } else {
    // per-class mode (legacy)
    const limit = pLimit(CONCURRENCY);
    let done = 0;
    const tasks = targets.map((fqcn) => limit(async () => {
      const fileBase = fqcnToFile(fqcn);
      const pumlPath = path.join(PUML_DIR, fileBase + '.puml');
      const svgPath = path.join(OUT_DIR, fileBase + '.svg');
      try {
        const puml = generatePuml(fqcn, nodesById, adjOut, adjIn, DEPTH, MAX_NODES);
        await writeFile(pumlPath, puml, 'utf8');
        await runPlantUml(pumlPath, OUT_DIR);
        await stat(svgPath);
        ok++;
      } catch (e) {
        fail++;
        failures.push({ fqcn, error: String(e.message || e) });
        errLog(`FAIL ${fqcn}: ${e.message || e}`);
      } finally {
        done++;
        if (done % 50 === 0 || done === targets.length) {
          const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
          log(`progress ${done}/${targets.length} ok=${ok} fail=${fail} elapsed=${elapsed}s`);
        }
        if (!KEEP_PUML) {
          try { await rm(pumlPath, { force: true }); } catch {}
        }
      }
    }));
    await Promise.all(tasks);
  }

  // Clean up puml files unless asked to keep them
  if (!KEEP_PUML && MODE === 'batch') {
    try {
      const { readdir, unlink } = await import('node:fs/promises');
      const files = await readdir(PUML_DIR);
      await Promise.all(files
        .filter((f) => f.endsWith('.puml'))
        .map((f) => unlink(path.join(PUML_DIR, f)).catch(() => {})));
    } catch {}
  }

  const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
  log(`DONE total=${targets.length} ok=${ok} fail=${fail} elapsed=${elapsed}s`);
  if (failures.length) {
    const reportPath = path.join(OUT_DIR, '_failures.json');
    await writeFile(reportPath, JSON.stringify(failures, null, 2));
    errLog(`failures written to ${reportPath}`);
  }
  if (fail > 0) process.exitCode = 2;
}

main().catch((e) => {
  errLog('FATAL', e);
  process.exit(1);
});
