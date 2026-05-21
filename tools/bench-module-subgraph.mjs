// cmd_486 benchmark: measure C_in / C_ext sizes and headless fcose layout time
// per module. Run with: node tools/bench-module-subgraph.mjs <version> [module ...]
//
// Layout time is measured in Node using cytoscape headless. In-browser timing
// will be different (the browser also renders frames), so this number is a
// floor — useful for "is the subgraph small enough to feel snappy?" answer.

import { readFileSync } from 'node:fs'
import { performance } from 'node:perf_hooks'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(__dirname, '..')

const cytoscape = (await import(resolve(repoRoot, 'viewer/node_modules/cytoscape/dist/cytoscape.cjs.js'))).default
const fcose = (await import(resolve(repoRoot, 'viewer/node_modules/cytoscape-fcose/cytoscape-fcose.js'))).default
cytoscape.use(fcose)

const EXTERNAL_REL_TYPES = new Set(['EXTENDS', 'IMPLEMENTS'])
const ACTIVE_TYPES = new Set(['EXTENDS', 'IMPLEMENTS'])

const version = process.argv[2] || 'v6u3'
const targets = process.argv.slice(3)

const classesPath = resolve(repoRoot, `data/versions/${version}/classes.json`)
const relationsPath = resolve(repoRoot, `data/versions/${version}/relations.json`)
const classesData = JSON.parse(readFileSync(classesPath, 'utf8'))
const relationsData = JSON.parse(readFileSync(relationsPath, 'utf8'))

const counts = {}
for (const n of classesData.nodes) counts[n.artifactId] = (counts[n.artifactId] || 0) + 1
const orderedArtifacts = Object.keys(counts).sort((a, b) => counts[b] - counts[a])
const modulesToBench = targets.length > 0 ? targets : orderedArtifacts.slice(0, 8)

function extractSubgraph(artifactId) {
  const classMap = new Map()
  const cIn = new Set()
  for (const node of classesData.nodes) {
    classMap.set(node.id, node)
    if (node.artifactId === artifactId) cIn.add(node.id)
  }
  const cExt = new Set()
  for (const edge of relationsData.edges) {
    if (!EXTERNAL_REL_TYPES.has(edge.relation_type)) continue
    if (!cIn.has(edge.from)) continue
    if (cIn.has(edge.to)) continue
    if (classMap.has(edge.to)) cExt.add(edge.to)
  }
  const visibleIds = new Set([...cIn, ...cExt])
  const edges = []
  let i = 0
  for (const e of relationsData.edges) {
    if (!ACTIVE_TYPES.has(e.relation_type)) continue
    if (!cIn.has(e.from)) continue
    if (!visibleIds.has(e.to)) continue
    edges.push({ data: { id: `e${i++}`, source: e.from, target: e.to, relation_type: e.relation_type } })
  }
  const nodes = []
  for (const id of cIn) {
    const n = classMap.get(id)
    nodes.push({ data: { id, label: n.simpleName, isExternal: false } })
  }
  for (const id of cExt) {
    const n = classMap.get(id)
    nodes.push({ data: { id, label: n.simpleName, isExternal: true } })
  }
  return { cIn, cExt, nodes, edges }
}

async function measureLayout(elements) {
  return new Promise(resolve => {
    const cy = cytoscape({ headless: true, styleEnabled: false, elements })
    const t0 = performance.now()
    const layout = cy.layout({
      name: 'fcose',
      animate: false,
      randomize: true,
      idealEdgeLength: 80,
      nodeRepulsion: 6000,
      numIter: 2000,
      tile: false,
      gravity: 0.25,
    })
    layout.one('layoutstop', () => {
      const ms = performance.now() - t0
      cy.destroy()
      resolve(ms)
    })
    layout.run()
  })
}

console.log(`# cmd_486 module-subgraph benchmark (version=${version})`)
console.log(`# total classes: ${classesData.nodes.length} / total edges: ${relationsData.edges.length}`)
console.log('')
console.log('| モジュール | C_in | C_ext | 合計 | 初期描画 (headless) |')
console.log('|-----------|------|-------|-----|-------------------|')
for (const m of modulesToBench) {
  const { cIn, cExt, nodes, edges } = extractSubgraph(m)
  if (cIn.size === 0) {
    console.log(`| ${m} | 0 | - | - | (該当クラス無し) |`)
    continue
  }
  // Run twice and take the min — JIT warm-up bias mitigation
  const t1 = await measureLayout([...nodes, ...edges])
  const t2 = await measureLayout([...nodes, ...edges])
  const best = Math.min(t1, t2)
  console.log(`| ${m} | ${cIn.size} | ${cExt.size} | ${cIn.size + cExt.size} | ${best.toFixed(0)}ms (edges=${edges.length}) |`)
}
