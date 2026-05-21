import { useState, useEffect, useRef, useCallback } from 'react'
import cytoscape from 'cytoscape'
import fcose from 'cytoscape-fcose'
import './App.css'

cytoscape.use(fcose)

const REL_TYPES = ['EXTENDS', 'IMPLEMENTS', 'USES', 'CONTAINS', 'DEPENDS']
const REL_COLORS = {
  EXTENDS: '#4A90D9',
  IMPLEMENTS: '#5BA85A',
  USES: '#888888',
  CONTAINS: '#888888',
  DEPENDS: '#888888',
}
const DEFAULT_ACTIVE_TYPES = new Set(['EXTENDS', 'IMPLEMENTS'])
const EDGE_WARNING_THRESHOLD = 5000
const LOD_COMPOUND_THRESHOLD = 0.3

const EXTERNAL_REL_TYPES = new Set(['EXTENDS', 'IMPLEMENTS'])
const ARTIFACT_NAME_PREFIX = 'nablarch-'
const shortArtifactName = (artId) =>
  artId && artId.startsWith(ARTIFACT_NAME_PREFIX)
    ? artId.slice(ARTIFACT_NAME_PREFIX.length)
    : (artId || '?')

const calcZoomBase = (zoom) => {
  if (zoom < 0.3) return 0.5
  if (zoom < 1.0) return 0.3
  return 0.15
}

const getPackageKey = (fqcn) => {
  const parts = fqcn.split('.')
  return parts.slice(0, Math.min(3, parts.length - 1)).join('.')
}

const hashArtifactColor = (artifactId) => {
  const id = artifactId || 'unknown'
  let hash = 0
  for (let i = 0; i < id.length; i++) {
    hash = id.charCodeAt(i) + ((hash << 5) - hash)
    hash |= 0
  }
  const hue = Math.abs(hash) % 360
  return `hsl(${hue}, 80%, 50%)`
}

const formatFieldLine = (f) => `${f.access || '+'} ${f.name}: ${f.type}`
const formatMethodLine = (m) => {
  const params = (m.params || []).join(', ')
  return `${m.access || '+'} ${m.name}(${params}): ${m.returnType}`
}

const buildLodLabels = (simpleName, fields, methods, isExternal, artifactId) => {
  const fn = (fields || []).length
  const mn = (methods || []).length
  const extTag = isExternal ? `\n[${shortArtifactName(artifactId)}]` : ''

  const simple = `${simpleName}${extTag}`
  const summary = `${simpleName}\nF:${fn} M:${mn}${extTag}`

  const maxFields = 6
  const maxMethods = 8
  const lines = [simpleName]
  if (isExternal) lines.push(`[${shortArtifactName(artifactId)}]`)
  lines.push('───────')
  const fs = (fields || []).slice(0, maxFields).map(formatFieldLine)
  lines.push(...fs)
  if (fn > maxFields) lines.push(`… +${fn - maxFields}`)
  lines.push('───────')
  const ms = (methods || []).slice(0, maxMethods).map(formatMethodLine)
  lines.push(...ms)
  if (mn > maxMethods) lines.push(`… +${mn - maxMethods}`)
  const uml = lines.join('\n')

  return { simple, summary, uml }
}

function AnalyzeModal({ version, onClose }) {
  const command = `java -jar tools/analyzer/target/nablarch-class-extractor-jar-with-dependencies.jar \\
  --jars /path/to/nablarch-jars \\
  --output data/versions/${version || '<VERSION>'} \\
  --version ${version || '<VERSION>'}`

  const handleDone = async () => {
    await fetch('/data/versions/index.json', { cache: 'no-store' })
    onClose(true)
  }

  return (
    <div className="modal-overlay" onClick={() => onClose(false)}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <h2>新バージョンを解析</h2>
        <p>以下のコマンドをターミナルで実行してください:</p>
        <pre className="modal-command">{command}</pre>
        <p className="modal-hint">
          実行後、<code>tools/update-index.sh</code> も実行してください:
        </p>
        <pre className="modal-command">bash tools/update-index.sh</pre>
        <div className="modal-actions">
          <button className="btn-secondary" onClick={() => onClose(false)}>キャンセル</button>
          <button className="btn-primary" onClick={handleDone}>実行しました（index.json を再読み込み）</button>
        </div>
      </div>
    </div>
  )
}

function App() {
  const cyRef = useRef(null)
  const cyInstance = useRef(null)

  const [loading, setLoading] = useState(true)
  const [loadingMsg, setLoadingMsg] = useState('Loading data...')
  const [selectedNode, setSelectedNode] = useState(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [artifacts, setArtifacts] = useState([])
  const [artifactClassCounts, setArtifactClassCounts] = useState({})
  const [stats, setStats] = useState(null)
  const [versions, setVersions] = useState([])
  const [selectedVersion, setSelectedVersion] = useState(null)
  const [showAnalyzeModal, setShowAnalyzeModal] = useState(false)
  const savedZoom = useRef(null)
  const searchQueryRef = useRef('')

  const [speedMultiplier, setSpeedMultiplier] = useState(() => {
    const saved = localStorage.getItem('zoomSpeedMultiplier')
    return saved ? parseFloat(saved) : 1.0
  })
  const speedMultiplierRef = useRef(
    parseFloat(localStorage.getItem('zoomSpeedMultiplier') || '1.0')
  )

  // Lazy relations state
  const relationsDataRef = useRef(null)
  const adjRef = useRef(null)
  const [relationsLoading, setRelationsLoading] = useState(false)
  const [activeRelTypes, setActiveRelTypes] = useState(new Set(DEFAULT_ACTIVE_TYPES))
  const activeRelTypesRef = useRef(new Set(DEFAULT_ACTIVE_TYPES))
  const selectedVersionRef = useRef(null)

  // N-level expand mode
  const [expandMode, setExpandMode] = useState(false)
  const expandModeRef = useRef(false)
  const [focusNodeId, setFocusNodeId] = useState(null)
  const [expandLevel, setExpandLevel] = useState(0)
  const expandRingsRef = useRef([])

  // Filter panel state
  const [filterOpen, setFilterOpen] = useState(true)
  const [selectedArtifacts, setSelectedArtifacts] = useState(new Set())
  const selectedArtifactsRef = useRef(new Set())
  const [packageFilter, setPackageFilter] = useState('')
  const packageFilterRef = useRef('')
  const [visibleNodeCount, setVisibleNodeCount] = useState(0)
  const [edgeWarning, setEdgeWarning] = useState(false)

  // LOD compound node state
  const [lodCompoundMode, setLodCompoundMode] = useState(false)
  const lodCompoundModeRef = useRef(false)
  const compoundNodeIdsRef = useRef(new Set())

  // Class-centric view
  const [classCentricMode, setClassCentricMode] = useState(false)
  const classCentricModeRef = useRef(false)
  const [classCentricFocusId, setClassCentricFocusId] = useState(null)
  const [classCentricDepth, setClassCentricDepth] = useState(2)
  const classCentricDepthRef = useRef(2)

  // Module subgraph view (cmd_486)
  // moduleView: true while showing the artifact picker (initial state).
  // Once a module is selected, the cytoscape graph is populated with C_in + C_ext
  // (or the full 2127 nodes if the user explicitly opts into the legacy "全て表示" path).
  const [moduleView, setModuleView] = useState(true)
  const [selectedModule, setSelectedModule] = useState(null)
  const [moduleSearchQuery, setModuleSearchQuery] = useState('')
  const [cInCount, setCInCount] = useState(0)
  const [cExtCount, setCExtCount] = useState(0)
  const [fullViewMode, setFullViewMode] = useState(false)
  const fullViewModeRef = useRef(false)
  const classesDataRef = useRef(null)
  const [moduleLoadMs, setModuleLoadMs] = useState(null)

  // Full graph warning
  const [fullGraphWarningDismissed, setFullGraphWarningDismissed] = useState(false)

  // Display mode (simple / summary / uml) — cmd_487 Phase2
  const [displayMode, setDisplayMode] = useState(() => localStorage.getItem('displayMode') || 'summary')
  const displayModeRef = useRef(localStorage.getItem('displayMode') || 'summary')
  const classDetailsRef = useRef(new Map())

  useEffect(() => {
    async function loadIndex() {
      try {
        const res = await fetch('/data/versions/index.json')
        if (!res.ok) throw new Error(`index.json: HTTP ${res.status}`)
        const data = await res.json()
        const done = (data.versions || []).filter(v => v.status === 'done')
        const sorted = done.sort((a, b) => (b.analyzed_at || '').localeCompare(a.analyzed_at || ''))
        setVersions(sorted)
        if (sorted.length > 0) setSelectedVersion(sorted[0].version)
      } catch (err) {
        setLoadingMsg(`Error loading index.json: ${err.message}`)
      }
    }
    loadIndex()
  }, [])

  // Build adjacency map for expand mode BFS
  const buildAdjacency = useCallback((relData, types) => {
    const adj = new Map()
    for (const edge of relData.edges) {
      if (!types.has(edge.relation_type)) continue
      if (!adj.has(edge.from)) adj.set(edge.from, new Set())
      adj.get(edge.from).add(edge.to)
      if (!adj.has(edge.to)) adj.set(edge.to, new Set())
      adj.get(edge.to).add(edge.from)
    }
    return adj
  }, [])

  // Load relations.json lazily and cache
  const loadRelations = useCallback(async () => {
    if (relationsDataRef.current) return relationsDataRef.current
    setRelationsLoading(true)
    try {
      const version = selectedVersionRef.current
      const res = await fetch(`/data/versions/${version}/relations.json`)
      if (!res.ok) throw new Error(`relations.json: HTTP ${res.status}`)
      const data = await res.json()
      relationsDataRef.current = data
      return data
    } catch (err) {
      console.error('Failed to load relations:', err)
      return null
    } finally {
      setRelationsLoading(false)
    }
  }, [])

  // Apply artifact + package filter via opacity animation (no-op in expand / compound / class-centric mode).
  // Hidden nodes keep display:'element' so cytoscape's layout positions remain stable —
  // only opacity changes, letting fit() target the bright subset.
  const applyNodeFilter = useCallback(() => {
    const cy = cyInstance.current
    if (!cy || expandModeRef.current || lodCompoundModeRef.current || classCentricModeRef.current) return

    const selArt = selectedArtifactsRef.current
    const pkgFilter = packageFilterRef.current.toLowerCase().trim()
    const compoundIds = compoundNodeIdsRef.current

    cy.nodes().forEach(node => {
      if (compoundIds.has(node.id())) return
      const artMatch = selArt.has(node.data('artifactId'))
      const fqcn = (node.data('fqcn') || '').toLowerCase()
      const pkgMatch = !pkgFilter || fqcn.startsWith(pkgFilter)
      const targetOpacity = artMatch && pkgMatch ? 1.0 : 0.05
      node.style('display', 'element')
      node.stop(true)
      node.animate({ style: { opacity: targetOpacity } }, { duration: 600, easing: 'ease-in-out-sine' })
    })
    cy.edges().forEach(edge => {
      if (compoundIds.has(edge.source().id()) || compoundIds.has(edge.target().id())) return
      const srcArt = selArt.has(edge.source().data('artifactId'))
      const tgtArt = selArt.has(edge.target().data('artifactId'))
      const srcFqcn = (edge.source().data('fqcn') || '').toLowerCase()
      const tgtFqcn = (edge.target().data('fqcn') || '').toLowerCase()
      const srcPkg = !pkgFilter || srcFqcn.startsWith(pkgFilter)
      const tgtPkg = !pkgFilter || tgtFqcn.startsWith(pkgFilter)
      const bothActive = srcArt && tgtArt && srcPkg && tgtPkg
      edge.style('display', 'element')
      edge.stop(true)
      edge.animate({ style: { opacity: bothActive ? 0.25 : 0.05 } }, { duration: 600, easing: 'ease-in-out-sine' })
    })

    const visible = cy.nodes().filter(n =>
      !compoundIds.has(n.id()) &&
      selArt.has(n.data('artifactId')) &&
      (!pkgFilter || (n.data('fqcn') || '').toLowerCase().startsWith(pkgFilter))
    ).length
    setVisibleNodeCount(visible)
  }, [])

  // Enter LOD compound mode: fold class nodes into package group summary nodes
  const enterLODCompound = useCallback(() => {
    const cy = cyInstance.current
    if (!cy || lodCompoundModeRef.current || expandModeRef.current) return

    const t0 = performance.now()
    lodCompoundModeRef.current = true
    setLodCompoundMode(true)

    const groups = new Map()
    cy.nodes().forEach(node => {
      if (compoundNodeIdsRef.current.has(node.id())) return
      const fqcn = node.data('fqcn')
      if (!fqcn) return
      const pkgKey = getPackageKey(fqcn)
      if (!groups.has(pkgKey)) groups.set(pkgKey, { count: 0, sumX: 0, sumY: 0 })
      const g = groups.get(pkgKey)
      g.count++
      const pos = node.position()
      g.sumX += pos.x
      g.sumY += pos.y
    })

    const newCompoundIds = new Set()
    const elementsToAdd = []

    groups.forEach((g, pkgKey) => {
      const compoundId = `__cpd__${pkgKey}`
      newCompoundIds.add(compoundId)
      elementsToAdd.push({
        data: {
          id: compoundId,
          label: `${pkgKey}\n(${g.count})`,
          pkgKey,
          nodeCount: g.count,
          isCompound: true,
        },
        position: { x: g.sumX / g.count, y: g.sumY / g.count },
      })
    })

    cy.batch(() => {
      cy.nodes().style('display', 'none')
      cy.edges().style('display', 'none')
      if (elementsToAdd.length > 0) cy.add(elementsToAdd)
      newCompoundIds.forEach(cid => {
        const n = cy.getElementById(cid)
        if (n.length > 0) n.style('display', 'element')
      })
    })

    compoundNodeIdsRef.current = newCompoundIds

    const t1 = performance.now()
    console.log(`[LOD] Compound mode entered: ${elementsToAdd.length} groups in ${(t1 - t0).toFixed(1)}ms`)
  }, [])

  // Exit LOD compound mode: restore individual class nodes
  const exitLODCompound = useCallback(() => {
    const cy = cyInstance.current
    if (!cy || !lodCompoundModeRef.current) return

    const t0 = performance.now()
    lodCompoundModeRef.current = false
    setLodCompoundMode(false)

    cy.batch(() => {
      compoundNodeIdsRef.current.forEach(cid => {
        const n = cy.getElementById(cid)
        if (n.length > 0) n.remove()
      })
      compoundNodeIdsRef.current = new Set()
      cy.nodes().style('display', 'element')
      cy.edges().style('display', 'element')
    })

    applyNodeFilter()

    const t1 = performance.now()
    console.log(`[LOD] Compound mode exited in ${(t1 - t0).toFixed(1)}ms`)
  }, [applyNodeFilter])

  // Apply edge filter to cytoscape graph
  const applyEdgeFilter = useCallback((relData, types) => {
    const cy = cyInstance.current
    if (!cy || !relData) return
    cy.batch(() => {
      cy.edges().remove()
      const edges = relData.edges
        .filter(e => types.has(e.relation_type))
        .map((edge, i) => ({
          data: {
            id: `e${i}`,
            source: edge.from,
            target: edge.to,
            relation_type: edge.relation_type,
          },
        }))

      setEdgeWarning(edges.length > EDGE_WARNING_THRESHOLD)
      if (edges.length > 0) cy.add(edges)
      setStats(s => s ? { ...s, edges: edges.length } : s)

      if (expandModeRef.current && expandRingsRef.current.length > 0) {
        const visibleIds = new Set(expandRingsRef.current.flatMap(r => [...r]))
        cy.edges().forEach(e => {
          if (!visibleIds.has(e.source().id()) || !visibleIds.has(e.target().id())) {
            e.style('display', 'none')
          }
        })
      }
    })
    adjRef.current = buildAdjacency(relData, types)
    applyNodeFilter()
  }, [buildAdjacency, applyNodeFilter])

  // Handle relation type checkbox toggle
  const handleRelTypeToggle = useCallback(async (type) => {
    const newTypes = new Set(activeRelTypesRef.current)
    if (newTypes.has(type)) newTypes.delete(type)
    else newTypes.add(type)
    setActiveRelTypes(newTypes)
    activeRelTypesRef.current = newTypes

    const data = await loadRelations()
    if (data) applyEdgeFilter(data, newTypes)
  }, [loadRelations, applyEdgeFilter])

  // Artifact filter handlers
  const handleArtifactToggle = useCallback((artId) => {
    const next = new Set(selectedArtifactsRef.current)
    if (next.has(artId)) next.delete(artId)
    else next.add(artId)
    setSelectedArtifacts(next)
    selectedArtifactsRef.current = next
    applyNodeFilter()
  }, [applyNodeFilter])

  const handleArtifactSelectAll = useCallback(() => {
    const all = new Set(artifacts.map(a => a.artifactId))
    setSelectedArtifacts(all)
    selectedArtifactsRef.current = all
    applyNodeFilter()
  }, [artifacts, applyNodeFilter])

  const handleArtifactDeselectAll = useCallback(() => {
    const empty = new Set()
    setSelectedArtifacts(empty)
    selectedArtifactsRef.current = empty
    applyNodeFilter()
  }, [applyNodeFilter])

  // Package filter handler
  const handlePackageFilterChange = useCallback((val) => {
    setPackageFilter(val)
    packageFilterRef.current = val
    applyNodeFilter()
  }, [applyNodeFilter])

  // BFS subgraph from a focus node — used by both class-centric entry and depth adjustment
  const applyClassCentricSubgraph = useCallback((focusId, depth) => {
    const cy = cyInstance.current
    if (!cy || !focusId || !adjRef.current) return 0

    const visible = new Set([focusId])
    let frontier = new Set([focusId])
    for (let i = 0; i < depth; i++) {
      const next = new Set()
      for (const nodeId of frontier) {
        for (const nId of (adjRef.current.get(nodeId) || new Set())) {
          if (!visible.has(nId)) {
            visible.add(nId)
            next.add(nId)
          }
        }
      }
      if (next.size === 0) break
      frontier = next
    }

    cy.batch(() => {
      cy.nodes().forEach(n => {
        if (n.data('isCompound')) return
        n.style('display', visible.has(n.id()) ? 'element' : 'none')
        n.removeClass('focus highlighted dimmed artifact-peer')
      })
      cy.edges().forEach(e => {
        const vis = visible.has(e.source().id()) && visible.has(e.target().id())
        e.style('display', vis ? 'element' : 'none')
      })
      const focusNode = cy.getElementById(focusId)
      if (focusNode.length > 0) {
        focusNode.style('display', 'element').addClass('focus')
      }
      const visNodes = cy.nodes().filter(n => visible.has(n.id()) && !n.data('isCompound'))
      if (visNodes.length > 0) cy.fit(visNodes, 80)
    })

    return visible.size
  }, [])

  // Enter class-centric view: search for a node and show N-level dependency subgraph
  const enterClassCentricView = useCallback(async (query, depth) => {
    const cy = cyInstance.current
    if (!cy || !query.trim()) return

    // Exit other exclusive modes first
    if (lodCompoundModeRef.current) exitLODCompound()
    if (expandModeRef.current) {
      expandModeRef.current = false
      setExpandMode(false)
      setFocusNodeId(null)
      setExpandLevel(0)
      expandRingsRef.current = []
    }

    // Set class-centric flag early to prevent applyNodeFilter interference
    classCentricModeRef.current = true
    setClassCentricMode(true)

    // Load relations if needed (required for BFS adjacency)
    const data = await loadRelations()
    if (!data) {
      classCentricModeRef.current = false
      setClassCentricMode(false)
      return
    }

    // Add edges to graph if not yet loaded
    if (cy.edges().length === 0) {
      cy.batch(() => {
        const edges = data.edges
          .filter(e => activeRelTypesRef.current.has(e.relation_type))
          .map((edge, i) => ({
            data: {
              id: `e${i}`,
              source: edge.from,
              target: edge.to,
              relation_type: edge.relation_type,
            },
          }))
        if (edges.length > 0) cy.add(edges)
        setStats(s => s ? { ...s, edges: edges.length } : s)
      })
    }

    // Build adjacency if needed
    if (!adjRef.current) {
      adjRef.current = buildAdjacency(data, activeRelTypesRef.current)
    }

    // Find matching node — prefer exact match, then partial
    const lq = query.toLowerCase()
    let focusNode = null
    cy.nodes().forEach(n => {
      if (n.data('isCompound') || focusNode) return
      const fqcn = (n.data('fqcn') || '').toLowerCase()
      const label = (n.data('label') || '').toLowerCase()
      if (fqcn === lq || label === lq) focusNode = n
    })
    if (!focusNode) {
      cy.nodes().forEach(n => {
        if (n.data('isCompound') || focusNode) return
        const fqcn = (n.data('fqcn') || '').toLowerCase()
        const label = (n.data('label') || '').toLowerCase()
        if (fqcn.includes(lq) || label.includes(lq)) focusNode = n
      })
    }

    if (!focusNode) {
      classCentricModeRef.current = false
      setClassCentricMode(false)
      return
    }

    const focusId = focusNode.id()
    setClassCentricFocusId(focusId)
    setSelectedNode(null)

    const count = applyClassCentricSubgraph(focusId, depth)
    setVisibleNodeCount(count)
  }, [loadRelations, buildAdjacency, applyClassCentricSubgraph, exitLODCompound])

  // Exit class-centric view and return to normal filtered display
  const exitClassCentricView = useCallback(() => {
    classCentricModeRef.current = false
    setClassCentricMode(false)
    setClassCentricFocusId(null)

    const cy = cyInstance.current
    if (cy) {
      cy.nodes().removeClass('focus highlighted dimmed artifact-peer')
      cy.edges().removeClass('active-edge inactive-edge')
    }
    applyNodeFilter()
  }, [applyNodeFilter])

  // Reset exclusive modes (LOD compound, expand, class-centric) before swapping the graph contents.
  const resetExclusiveModes = useCallback(() => {
    if (lodCompoundModeRef.current) {
      lodCompoundModeRef.current = false
      setLodCompoundMode(false)
      compoundNodeIdsRef.current = new Set()
    }
    if (expandModeRef.current) {
      expandModeRef.current = false
      setExpandMode(false)
      setFocusNodeId(null)
      setExpandLevel(0)
      expandRingsRef.current = []
    }
    if (classCentricModeRef.current) {
      classCentricModeRef.current = false
      setClassCentricMode(false)
      setClassCentricFocusId(null)
    }
    setSelectedNode(null)
  }, [])

  // Build a cytoscape node element from raw class data.
  // External nodes (C_ext) carry isExternal=true and a 2-line label "simpleName\n[shortArtifact]"
  // so the dedicated style selector can apply dashed borders + module hint.
  // Also precomputes LOD labels (simple/summary/uml) used by updateNodeLabels.
  const buildNodeElement = useCallback((node, isExternal) => {
    const { simple, summary, uml } = buildLodLabels(
      node.simpleName, node.fields, node.methods, isExternal, node.artifactId
    )
    const initialLabel = displayModeRef.current === 'simple'
      ? simple
      : displayModeRef.current === 'uml' ? simple : summary
    return {
      data: {
        id: node.id,
        label: initialLabel,
        fqcn: node.fqcn,
        artifactId: node.artifactId,
        type: node.type,
        modifiers: node.modifiers,
        package: node.package,
        color: hashArtifactColor(node.artifactId),
        isCompound: false,
        isExternal: isExternal || undefined,
        lodSimple: simple,
        lodSummary: summary,
        lodUml: uml,
        fieldCount: (node.fields || []).length,
        methodCount: (node.methods || []).length,
      },
    }
  }, [])

  // Re-evaluate node labels for current displayMode + zoom.
  // simple: always lodSimple, summary: always lodSummary,
  // uml: zoom<0.3 → simple, 0.3..1.0 → summary, >1.0 → full UML.
  const updateNodeLabels = useCallback((cy, mode, zoom) => {
    if (!cy) return
    cy.batch(() => {
      cy.nodes().forEach(n => {
        if (n.data('isCompound')) return
        let lbl
        if (mode === 'simple') {
          lbl = n.data('lodSimple')
        } else if (mode === 'summary') {
          lbl = n.data('lodSummary')
        } else {
          if (zoom < LOD_COMPOUND_THRESHOLD) lbl = n.data('lodSimple')
          else if (zoom < 1.0) lbl = n.data('lodSummary')
          else lbl = n.data('lodUml')
        }
        if (lbl != null && lbl !== n.data('label')) n.data('label', lbl)
      })
    })
  }, [])

  const handleDisplayModeChange = useCallback((mode) => {
    setDisplayMode(mode)
    displayModeRef.current = mode
    try { localStorage.setItem('displayMode', mode) } catch (_) {}
    const cy = cyInstance.current
    if (cy) updateNodeLabels(cy, mode, cy.zoom())
  }, [updateNodeLabels])

  // Run fcose layout against the current cy contents and resolve when layoutstop fires.
  // We measure from layout.run() to layoutstop and log the benchmark for PR-grade timing data.
  const runLayoutAndMeasure = useCallback((cy, label) => {
    return new Promise(resolve => {
      const t0 = performance.now()
      const layout = cy.layout({
        name: 'fcose',
        animate: true,
        animationDuration: 1200,
        animationEasing: 'ease-out',
        randomize: true,
        idealEdgeLength: 80,
        nodeRepulsion: 6000,
        numIter: 2000,
        tile: false,
        gravity: 0.25,
        gravityRangeCompound: 1.5,
      })
      layout.one('layoutstop', () => {
        const ms = performance.now() - t0
        console.log(`[Bench] ${label} layout: ${ms.toFixed(1)}ms`)
        resolve(ms)
      })
      layout.run()
    })
  }, [])

  // Enter module-subgraph view: render only C_in (selected artifact) + C_ext (EXTENDS/IMPLEMENTS depth 1)
  const enterModuleView = useCallback(async (artifactId) => {
    const cy = cyInstance.current
    const classesData = classesDataRef.current
    if (!cy || !classesData) return

    setLoading(true)
    setLoadingMsg(`モジュール「${artifactId}」のサブグラフを構築中...`)
    resetExclusiveModes()

    // relations are required to discover C_ext via EXTENDS/IMPLEMENTS
    const relData = await loadRelations()
    if (!relData) {
      setLoading(false)
      setLoadingMsg('relations.json の読み込みに失敗しました')
      return
    }

    const t_total_start = performance.now()

    // C_in: classes whose artifactId matches the selection
    const cInIds = new Set()
    const classMap = new Map()
    for (const node of classesData.nodes) {
      classMap.set(node.id, node)
      if (node.artifactId === artifactId) cInIds.add(node.id)
    }

    // C_ext: outgoing EXTENDS/IMPLEMENTS targets of C_in classes that live outside C_in
    const cExtIds = new Set()
    for (const edge of relData.edges) {
      if (!EXTERNAL_REL_TYPES.has(edge.relation_type)) continue
      if (!cInIds.has(edge.from)) continue
      if (cInIds.has(edge.to)) continue
      if (classMap.has(edge.to)) cExtIds.add(edge.to)
    }

    // Build cytoscape elements
    const nodeElements = []
    for (const id of cInIds) {
      const n = classMap.get(id)
      if (n) nodeElements.push(buildNodeElement(n, false))
    }
    for (const id of cExtIds) {
      const n = classMap.get(id)
      if (n) nodeElements.push(buildNodeElement(n, true))
    }

    // Edges: only those whose source is in C_in and target is in (C_in ∪ C_ext),
    // filtered by the active relation-type set.
    const visibleIds = new Set([...cInIds, ...cExtIds])
    const activeTypes = activeRelTypesRef.current
    const edgeElements = []
    let edgeIdx = 0
    for (const edge of relData.edges) {
      if (!activeTypes.has(edge.relation_type)) continue
      if (!cInIds.has(edge.from)) continue
      if (!visibleIds.has(edge.to)) continue
      edgeElements.push({
        data: {
          id: `e${edgeIdx++}`,
          source: edge.from,
          target: edge.to,
          relation_type: edge.relation_type,
        },
      })
    }

    cy.batch(() => {
      cy.elements().remove()
      cy.add(nodeElements)
      cy.add(edgeElements)
    })

    // ensure the adjacency map (used by expand-mode / class-centric BFS) reflects the
    // full relations dataset so those modes still work inside a module view.
    if (!adjRef.current) {
      adjRef.current = buildAdjacency(relData, activeTypes)
    }

    setCInCount(cInIds.size)
    setCExtCount(cExtIds.size)
    setSelectedModule(artifactId)
    setFullViewMode(false)
    fullViewModeRef.current = false
    setStats(s => s ? { ...s, edges: edgeElements.length } : { nodes: classesData.nodes.length, edges: edgeElements.length })
    setVisibleNodeCount(cInIds.size + cExtIds.size)
    setModuleView(false)

    const layoutMs = await runLayoutAndMeasure(cy, `module:${artifactId}`)
    const t_total = performance.now() - t_total_start
    console.log(`[Bench] module:${artifactId} total (extract+add+layout): ${t_total.toFixed(1)}ms`)
    setModuleLoadMs(layoutMs)

    const allNodes = cy.nodes()
    if (allNodes.length > 0) cy.fit(allNodes, 80)

    // Refresh labels per current display mode + zoom (cmd_487 Phase2)
    updateNodeLabels(cy, displayModeRef.current, cy.zoom())

    setLoading(false)
  }, [resetExclusiveModes, loadRelations, buildNodeElement, runLayoutAndMeasure, buildAdjacency, updateNodeLabels])

  // Enter full-graph view: legacy behavior — render all 2127 nodes. Slow, kept behind explicit opt-in.
  const enterFullView = useCallback(async () => {
    const cy = cyInstance.current
    const classesData = classesDataRef.current
    if (!cy || !classesData) return

    setLoading(true)
    setLoadingMsg(`全 ${classesData.nodes.length} ノードを読み込み中...`)
    resetExclusiveModes()

    const t_total_start = performance.now()

    const nodeElements = classesData.nodes.map(n => buildNodeElement(n, false))

    cy.batch(() => {
      cy.elements().remove()
      cy.add(nodeElements)
    })

    // edges are added lazily by loadRelations + applyEdgeFilter so the user can toggle relation types
    const relData = await loadRelations()
    if (relData) {
      applyEdgeFilter(relData, activeRelTypesRef.current)
    }

    const allArtIds = new Set(classesData.nodes.map(n => n.artifactId))
    setSelectedArtifacts(allArtIds)
    selectedArtifactsRef.current = allArtIds

    setCInCount(0)
    setCExtCount(0)
    setSelectedModule(null)
    setFullViewMode(true)
    fullViewModeRef.current = true
    setVisibleNodeCount(classesData.nodes.length)
    setModuleView(false)

    const layoutMs = await runLayoutAndMeasure(cy, 'full')
    const t_total = performance.now() - t_total_start
    console.log(`[Bench] full total (extract+add+layout): ${t_total.toFixed(1)}ms`)
    setModuleLoadMs(layoutMs)

    updateNodeLabels(cy, displayModeRef.current, cy.zoom())

    setLoading(false)
  }, [resetExclusiveModes, loadRelations, buildNodeElement, runLayoutAndMeasure, applyEdgeFilter, updateNodeLabels])

  // Return to module picker — clears the cytoscape contents so the picker overlay can take over.
  const exitToModuleSelection = useCallback(() => {
    const cy = cyInstance.current
    if (cy) {
      resetExclusiveModes()
      cy.elements().remove()
    }
    setSelectedModule(null)
    setFullViewMode(false)
    fullViewModeRef.current = false
    setCInCount(0)
    setCExtCount(0)
    setVisibleNodeCount(0)
    setModuleSearchQuery('')
    setModuleView(true)
  }, [resetExclusiveModes])

  // Load data (classes + artifacts only, no edges)
  useEffect(() => {
    if (!selectedVersion) return

    relationsDataRef.current = null
    adjRef.current = null
    selectedVersionRef.current = selectedVersion
    setExpandMode(false)
    expandModeRef.current = false
    setFocusNodeId(null)
    setExpandLevel(0)
    expandRingsRef.current = []
    setActiveRelTypes(new Set(DEFAULT_ACTIVE_TYPES))
    activeRelTypesRef.current = new Set(DEFAULT_ACTIVE_TYPES)
    setPackageFilter('')
    packageFilterRef.current = ''
    setSelectedArtifacts(new Set())
    selectedArtifactsRef.current = new Set()
    setVisibleNodeCount(0)
    setEdgeWarning(false)
    lodCompoundModeRef.current = false
    setLodCompoundMode(false)
    compoundNodeIdsRef.current = new Set()
    // Reset class-centric state
    setClassCentricMode(false)
    classCentricModeRef.current = false
    setClassCentricFocusId(null)
    setFullGraphWarningDismissed(false)
    // Reset module subgraph view state
    classesDataRef.current = null
    setModuleView(true)
    setSelectedModule(null)
    setModuleSearchQuery('')
    setCInCount(0)
    setCExtCount(0)
    setFullViewMode(false)
    fullViewModeRef.current = false
    setModuleLoadMs(null)

    async function loadData() {
      if (cyInstance.current) {
        savedZoom.current = cyInstance.current.zoom()
        cyInstance.current.destroy()
        cyInstance.current = null
      }
      setLoading(true)
      setSelectedNode(null)
      setLoadingMsg('Loading class data...')

      const t_start = performance.now()

      try {
        const [classesRes, artifactsRes] = await Promise.all([
          fetch(`/data/versions/${selectedVersion}/classes.json`),
          fetch(`/data/versions/${selectedVersion}/artifacts.json`),
        ])
        if (!classesRes.ok) throw new Error(`classes.json: HTTP ${classesRes.status}`)
        if (!artifactsRes.ok) throw new Error(`artifacts.json: HTTP ${artifactsRes.status}`)

        const classesData = await classesRes.json()
        const artifactsData = await artifactsRes.json()

        const t_data_loaded = performance.now()
        console.log(`[Bench] Data fetch: ${(t_data_loaded - t_start).toFixed(1)}ms (${classesData.nodes.length} nodes)`)

        classesDataRef.current = classesData

        // Build class details lookup map (id → full node) for fast detail panel lookup.
        const detailsMap = new Map()
        for (const node of classesData.nodes) {
          detailsMap.set(node.id, node)
        }
        classDetailsRef.current = detailsMap

        const counts = {}
        for (const node of classesData.nodes) {
          counts[node.artifactId] = (counts[node.artifactId] || 0) + 1
        }
        setArtifactClassCounts(counts)

        const allArtIds = new Set(artifactsData.artifacts.map(a => a.artifactId))
        setArtifacts(artifactsData.artifacts)
        setSelectedArtifacts(allArtIds)
        selectedArtifactsRef.current = allArtIds

        setStats({ nodes: classesData.nodes.length, edges: null })
        setVisibleNodeCount(0)

        const cy = cytoscape({
          container: cyRef.current,
          elements: [],
          style: [
            {
              selector: 'node',
              style: {
                'background-color': 'data(color)',
                'label': 'data(label)',
                'font-size': 10,
                'color': '#ffffff',
                'text-valign': 'center',
                'text-halign': 'center',
                'text-wrap': 'wrap',
                'text-max-width': 220,
                'width': 20,
                'height': 20,
                'text-outline-width': 1,
                'text-outline-color': '#000000',
                'text-opacity': 0,
              },
            },
            {
              selector: 'node:selected',
              style: {
                'border-color': '#FF3B30',
                'border-width': 4,
                'shadow-blur': 15,
                'shadow-color': '#FF3B30',
                'shadow-opacity': 0.6,
                'shadow-offset-x': 0,
                'shadow-offset-y': 0,
                'width': 30,
                'height': 30,
              },
            },
            {
              selector: 'node.highlighted',
              style: { 'border-width': 3, 'border-color': '#ffff00', 'width': 28, 'height': 28 },
            },
            {
              selector: 'node.dimmed',
              style: { 'opacity': 0.15 },
            },
            {
              selector: 'node.focus',
              style: { 'border-width': 4, 'border-color': '#ff6b6b', 'width': 34, 'height': 34 },
            },
            {
              selector: 'node[isCompound = true]',
              style: {
                'background-color': '#1e2a4a',
                'label': 'data(label)',
                'text-wrap': 'wrap',
                'text-max-width': 110,
                'font-size': 7,
                'color': '#aabbff',
                'text-valign': 'center',
                'text-halign': 'center',
                'width': 'mapData(nodeCount, 1, 200, 32, 72)',
                'height': 'mapData(nodeCount, 1, 200, 32, 72)',
                'text-outline-width': 0,
                'text-opacity': 1,
                'shape': 'roundrectangle',
                'border-width': 1.5,
                'border-color': '#4455aa',
              },
            },
            {
              selector: 'edge',
              style: {
                'width': 1,
                'line-color': '#444',
                'target-arrow-color': '#444',
                'target-arrow-shape': 'triangle',
                'curve-style': 'bezier',
                'opacity': 0.25,
              },
            },
            {
              selector: 'edge.active-edge',
              style: { 'opacity': 1.0, 'width': 2.5 },
            },
            {
              selector: 'edge.inactive-edge',
              style: { 'opacity': 0.05 },
            },
            {
              selector: 'node.artifact-peer',
              style: {
                'border-width': 3,
                'border-color': '#ffd700',
                'width': 26,
                'height': 26,
              },
            },
            {
              selector: 'node[isExternal = true]',
              style: {
                'border-style': 'dashed',
                'border-width': 3,
                'border-color': '#aaaaaa',
                'opacity': 0.7,
                'text-wrap': 'wrap',
                'text-max-width': 90,
                'font-size': 9,
              },
            },
            {
              selector: `edge[relation_type="EXTENDS"]`,
              style: { 'line-color': REL_COLORS.EXTENDS, 'target-arrow-color': REL_COLORS.EXTENDS },
            },
            {
              selector: `edge[relation_type="IMPLEMENTS"]`,
              style: { 'line-color': REL_COLORS.IMPLEMENTS, 'target-arrow-color': REL_COLORS.IMPLEMENTS },
            },
            {
              selector: `edge[relation_type="USES"]`,
              style: { 'line-color': REL_COLORS.USES, 'target-arrow-color': REL_COLORS.USES },
            },
            {
              selector: `edge[relation_type="CONTAINS"]`,
              style: { 'line-color': REL_COLORS.CONTAINS, 'target-arrow-color': REL_COLORS.CONTAINS },
            },
            {
              selector: `edge[relation_type="DEPENDS"]`,
              style: { 'line-color': REL_COLORS.DEPENDS, 'target-arrow-color': REL_COLORS.DEPENDS },
            },
          ],
          wheelSensitivity: 0.3,
        })

        cyInstance.current = cy

        const updateZoomSensitivity = (zoom, multiplier) => {
          cy.renderer().wheelSensitivity = calcZoomBase(zoom) * multiplier
        }

        cy.on('zoom', () => {
          const zoom = cy.zoom()
          if (!lodCompoundModeRef.current) {
            cy.nodes().style('text-opacity', zoom >= LOD_COMPOUND_THRESHOLD ? 1 : 0)
          }
          updateZoomSensitivity(zoom, speedMultiplierRef.current)

          // LOD: refresh labels per displayMode + zoom (cmd_487 Phase2)
          if (!lodCompoundModeRef.current) {
            updateNodeLabels(cy, displayModeRef.current, zoom)
          }

          if (!expandModeRef.current && !classCentricModeRef.current) {
            if (zoom < LOD_COMPOUND_THRESHOLD && !lodCompoundModeRef.current) {
              enterLODCompound()
            } else if (zoom >= LOD_COMPOUND_THRESHOLD && lodCompoundModeRef.current) {
              exitLODCompound()
            }
          }
        })

        cy.on('tap', 'node', evt => {
          const node = evt.target
          if (node.data('isCompound')) return
          if (expandModeRef.current) {
            const nodeId = node.id()
            setFocusNodeId(nodeId)
            setExpandLevel(0)
            expandRingsRef.current = [new Set([nodeId])]
            cy.batch(() => {
              cy.nodes().style('display', 'none').removeClass('focus highlighted dimmed artifact-peer')
              cy.edges().style('display', 'none').removeClass('active-edge inactive-edge')
              node.style('display', 'element').addClass('focus')
            })
          } else {
            const artifactId = node.data('artifactId')
            cy.batch(() => {
              cy.nodes().unselect()
              node.select()
              cy.nodes().removeClass('artifact-peer')
              cy.nodes().filter(n => n.data('artifactId') === artifactId && !n.data('isCompound'))
                .addClass('artifact-peer')
              const connectedEdges = node.connectedEdges()
              cy.edges().removeClass('active-edge inactive-edge')
              connectedEdges.addClass('active-edge')
              cy.edges().not(connectedEdges).addClass('inactive-edge')
            })

            // Build extends / implements / subclasses lists from connected edges
            const id = node.id()
            const extendsTo = []
            const implementsTo = []
            const subclassesOf = []
            node.connectedEdges().forEach(e => {
              const rt = e.data('relation_type')
              const srcId = e.source().id()
              const tgtId = e.target().id()
              if (rt === 'EXTENDS') {
                if (srcId === id) extendsTo.push(tgtId)
                else if (tgtId === id) subclassesOf.push(srcId)
              } else if (rt === 'IMPLEMENTS' && srcId === id) {
                implementsTo.push(tgtId)
              }
            })

            const detail = classDetailsRef.current.get(id)
            setSelectedNode({
              id,
              fqcn: node.data('fqcn'),
              artifactId: node.data('artifactId'),
              type: node.data('type'),
              modifiers: node.data('modifiers') || [],
              package: node.data('package'),
              color: node.data('color'),
              isExternal: !!node.data('isExternal'),
              fields: (detail && detail.fields) || [],
              methods: (detail && detail.methods) || [],
              extendsTo,
              implementsTo,
              subclassesOf,
            })

            // Center on selected node (Y) — 300ms ease-out
            cy.animate({ center: { eles: node }, duration: 300, easing: 'ease-out' })
          }
        })

        cy.on('tap', evt => {
          if (evt.target === cy && !expandModeRef.current) {
            setSelectedNode(null)
            cy.batch(() => {
              cy.nodes().unselect()
              cy.nodes().removeClass('artifact-peer')
              cy.edges().removeClass('active-edge inactive-edge')
            })
          }
        })

        cy.on('mouseover', 'edge', evt => {
          const edge = evt.target
          if (!edge.hasClass('inactive-edge')) {
            edge.style({ 'opacity': 1.0, 'width': 2.5 })
          }
        })

        cy.on('mouseout', 'edge', evt => {
          const edge = evt.target
          if (edge.hasClass('active-edge')) {
            edge.style({ 'opacity': 1.0, 'width': 2.5 })
          } else if (!edge.hasClass('inactive-edge')) {
            edge.style({ 'opacity': 0.25, 'width': 1 })
          }
        })

        updateZoomSensitivity(cy.zoom(), speedMultiplierRef.current)
        // No eager layout: the module-picker UI is shown next. enterModuleView /
        // enterFullView populate the cytoscape with nodes + edges on demand.
        setLoading(false)
      } catch (err) {
        setLoadingMsg(`Error loading data: ${err.message}`)
        setLoading(false)
      }
    }

    loadData()
  }, [selectedVersion, enterLODCompound, exitLODCompound, updateNodeLabels])

  // Toggle N-level expand mode
  const handleToggleExpandMode = useCallback(async () => {
    const cy = cyInstance.current
    if (!cy) return

    if (lodCompoundModeRef.current) exitLODCompound()

    // Exit class-centric mode if active
    if (classCentricModeRef.current) {
      classCentricModeRef.current = false
      setClassCentricMode(false)
      setClassCentricFocusId(null)
    }

    if (expandModeRef.current) {
      setExpandMode(false)
      expandModeRef.current = false
      setFocusNodeId(null)
      setExpandLevel(0)
      expandRingsRef.current = []
      cy.batch(() => {
        cy.nodes().style('display', 'element').removeClass('focus highlighted dimmed artifact-peer')
        cy.edges().style('display', 'element').removeClass('active-edge inactive-edge')
      })
      applyNodeFilter()
    } else {
      setExpandMode(true)
      expandModeRef.current = true
      setFocusNodeId(null)
      setExpandLevel(0)
      expandRingsRef.current = []
      setSelectedNode(null)
      const data = await loadRelations()
      if (data) applyEdgeFilter(data, activeRelTypesRef.current)
    }
  }, [loadRelations, applyEdgeFilter, applyNodeFilter, exitLODCompound])

  // +1レベル展開
  const handleExpandPlus = useCallback(() => {
    const cy = cyInstance.current
    if (!cy || !focusNodeId || !adjRef.current) return
    const rings = expandRingsRef.current
    const allVisible = new Set(rings.flatMap(r => [...r]))
    const newRing = new Set()
    for (const nodeId of allVisible) {
      const neighbors = adjRef.current.get(nodeId) || new Set()
      for (const nId of neighbors) {
        if (!allVisible.has(nId)) newRing.add(nId)
      }
    }
    if (newRing.size === 0) return

    rings.push(newRing)
    setExpandLevel(rings.length - 1)
    const newAllVisible = new Set([...allVisible, ...newRing])

    cy.batch(() => {
      for (const nodeId of newRing) {
        const n = cy.getElementById(nodeId)
        if (n.length > 0) n.style('display', 'element')
      }
      cy.edges().forEach(e => {
        if (
          newAllVisible.has(e.source().id()) &&
          newAllVisible.has(e.target().id())
        ) {
          e.style('display', 'element')
        }
      })
    })
  }, [focusNodeId])

  // -1レベル折り畳む
  const handleExpandMinus = useCallback(() => {
    const cy = cyInstance.current
    if (!cy || !focusNodeId) return
    const rings = expandRingsRef.current
    if (rings.length <= 1) return

    const lastRing = rings.pop()
    setExpandLevel(Math.max(0, rings.length - 1))
    const remaining = new Set(rings.flatMap(r => [...r]))

    cy.batch(() => {
      for (const nodeId of lastRing) {
        const n = cy.getElementById(nodeId)
        if (n.length > 0) n.style('display', 'none')
      }
      cy.edges().forEach(e => {
        const src = e.source().id()
        const tgt = e.target().id()
        if (!remaining.has(src) || !remaining.has(tgt)) {
          e.style('display', 'none')
        }
      })
    })
  }, [focusNodeId])

  // 全展開
  const handleExpandAll = useCallback(() => {
    const cy = cyInstance.current
    if (!cy) return
    const allIds = new Set()
    cy.nodes().forEach(n => allIds.add(n.id()))
    expandRingsRef.current = [allIds]
    setExpandLevel(0)
    cy.batch(() => {
      cy.nodes().style('display', 'element')
      cy.edges().style('display', 'element')
    })
  }, [])

  // リセット: 俯瞰モードに戻る
  const handleExpandReset = useCallback(() => {
    const cy = cyInstance.current
    if (!cy) return
    setExpandMode(false)
    expandModeRef.current = false
    setFocusNodeId(null)
    setExpandLevel(0)
    expandRingsRef.current = []
    cy.batch(() => {
      cy.nodes().style('display', 'element').removeClass('focus highlighted dimmed artifact-peer')
      cy.edges().style('display', 'element').removeClass('active-edge inactive-edge')
    })
    applyNodeFilter()
  }, [applyNodeFilter])

  const handleSearch = useCallback((query) => {
    setSearchQuery(query)
    searchQueryRef.current = query
    const cy = cyInstance.current
    if (!cy) return

    if (!query.trim()) {
      cy.nodes().removeClass('highlighted dimmed')
      return
    }

    const lq = query.toLowerCase()
    const matched = cy.nodes().filter(n => {
      const fqcn = (n.data('fqcn') || '').toLowerCase()
      const simple = (n.data('lodSimple') || n.data('label') || '').toLowerCase()
      return fqcn.includes(lq) || simple.includes(lq)
    })

    if (matched.length === 0) {
      cy.nodes().removeClass('highlighted dimmed')
      return
    }

    cy.nodes().addClass('dimmed').removeClass('highlighted')
    matched.removeClass('dimmed').addClass('highlighted')
    cy.fit(matched, 80)
  }, [])

  const handleSearchKeyDown = useCallback(async (e) => {
    if (e.key === 'Enter' && searchQueryRef.current.trim()) {
      await enterClassCentricView(searchQueryRef.current, classCentricDepthRef.current)
    } else if (e.key === 'Escape' && classCentricModeRef.current) {
      exitClassCentricView()
    }
  }, [enterClassCentricView, exitClassCentricView])

  const handleClassCentricDepthChange = useCallback((newDepth) => {
    setClassCentricDepth(newDepth)
    classCentricDepthRef.current = newDepth
    if (classCentricModeRef.current && classCentricFocusId) {
      const count = applyClassCentricSubgraph(classCentricFocusId, newDepth)
      setVisibleNodeCount(count)
    }
  }, [classCentricFocusId, applyClassCentricSubgraph])

  const handleSpeedMultiplierChange = useCallback((e) => {
    const value = parseFloat(e.target.value)
    setSpeedMultiplier(value)
    speedMultiplierRef.current = value
    localStorage.setItem('zoomSpeedMultiplier', String(value))
    const cy = cyInstance.current
    if (cy) {
      cy.renderer().wheelSensitivity = calcZoomBase(cy.zoom()) * value
    }
  }, [])

  const handleAnalyzeModalClose = useCallback(async (refreshed) => {
    setShowAnalyzeModal(false)
    if (refreshed) {
      try {
        const res = await fetch('/data/versions/index.json', { cache: 'no-store' })
        if (res.ok) {
          const data = await res.json()
          const done = (data.versions || []).filter(v => v.status === 'done')
          setVersions(done)
        }
      } catch (_) {}
    }
  }, [])

  // Close the slide-in detail panel and clear node highlight (cmd_487 Phase2)
  const closeDetailPanel = useCallback(() => {
    setSelectedNode(null)
    const cy = cyInstance.current
    if (!cy) return
    cy.batch(() => {
      cy.nodes().unselect()
      cy.nodes().removeClass('artifact-peer')
      cy.edges().removeClass('active-edge inactive-edge')
    })
  }, [])

  // ESC closes the detail panel (but only when no other modal/mode owns ESC)
  useEffect(() => {
    if (!selectedNode) return
    const onKey = (e) => {
      if (e.key !== 'Escape') return
      if (showAnalyzeModal) return
      if (classCentricMode || expandMode) return
      closeDetailPanel()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [selectedNode, showAnalyzeModal, classCentricMode, expandMode, closeDetailPanel])

  const showFullGraphWarning = !loading && !classCentricMode && fullViewMode && !fullGraphWarningDismissed && (stats?.nodes ?? 0) > 500

  const sortedArtifactsForPicker = [...artifacts].sort((a, b) =>
    (artifactClassCounts[b.artifactId] || 0) - (artifactClassCounts[a.artifactId] || 0)
  )
  const filteredArtifactsForPicker = moduleSearchQuery.trim()
    ? sortedArtifactsForPicker.filter(a =>
        a.artifactId.toLowerCase().includes(moduleSearchQuery.toLowerCase()))
    : sortedArtifactsForPicker

  return (
    <div className="app">
      {loading && (
        <div className="loading-overlay">
          <div className="loading-content">
            <div className="spinner" />
            <p>{loadingMsg}</p>
          </div>
        </div>
      )}

      <div className="toolbar">
        <h1>Nablarch Class Visualizer</h1>
        {stats && !moduleView && (
          <span className="stats">
            {selectedModule ? (
              <>
                <span className="module-label">{selectedModule}</span>
                <span className="stats-cin"> C_in:{cInCount}</span>
                <span className="stats-cext"> / C_ext:{cExtCount}</span>
                {moduleLoadMs != null && (
                  <span className="stats-bench"> · layout {moduleLoadMs.toFixed(0)}ms</span>
                )}
              </>
            ) : fullViewMode ? (
              <>{visibleNodeCount} / {stats.nodes} classes (全表示)</>
            ) : (
              <>{stats.nodes} classes</>
            )}
            {stats.edges != null ? ` · ${stats.edges} relations` : ''}
          </span>
        )}

        {!moduleView && (
          <button
            className="btn-change-module"
            onClick={exitToModuleSelection}
            disabled={loading}
            title="モジュール選択に戻る"
          >
            ◂ モジュールを変更
          </button>
        )}

        {lodCompoundMode && (
          <span className="lod-compound-badge" title="ズームインするとノードが展開されます">
            📦 パッケージグループ表示
          </span>
        )}

        <div className="version-selector">
          <select
            value={selectedVersion || ''}
            onChange={e => setSelectedVersion(e.target.value)}
            disabled={loading}
          >
            {versions.map(v => (
              <option key={v.version} value={v.version}>
                {v.version} — {v.total_classes} classes
                {v.analyzed_at ? ` (${v.analyzed_at.slice(0, 10)})` : ''}
              </option>
            ))}
          </select>
          <button
            className="btn-analyze"
            onClick={() => setShowAnalyzeModal(true)}
            disabled={loading}
            title="新バージョンを解析"
          >
            + 新バージョンを解析
          </button>
        </div>

        <div className="zoom-speed-control">
          <label className="zoom-speed-label">ズーム速度</label>
          <input
            type="range"
            min="0.5"
            max="3.0"
            step="0.1"
            value={speedMultiplier}
            onChange={handleSpeedMultiplierChange}
            className="zoom-speed-slider"
          />
          <span className="zoom-speed-value">{speedMultiplier.toFixed(1)}x</span>
        </div>

        <div className="display-mode-switch" role="group" aria-label="表示モード">
          <button
            className={`display-mode-btn${displayMode === 'simple' ? ' active' : ''}`}
            onClick={() => handleDisplayModeChange('simple')}
            disabled={loading}
            title="クラス名のみ（LOD無効）"
          >シンプル</button>
          <button
            className={`display-mode-btn${displayMode === 'summary' ? ' active' : ''}`}
            onClick={() => handleDisplayModeChange('summary')}
            disabled={loading}
            title="クラス名 + フィールド数/メソッド数"
          >サマリ</button>
          <button
            className={`display-mode-btn${displayMode === 'uml' ? ' active' : ''}`}
            onClick={() => handleDisplayModeChange('uml')}
            disabled={loading}
            title="ズームに応じて段階表示（LOD）"
          >UML</button>
        </div>

        <button
          className={`btn-expand-mode${expandMode ? ' active' : ''}`}
          onClick={handleToggleExpandMode}
          disabled={loading || moduleView}
          title="N段階展開モード"
        >
          {expandMode ? '展開モード ON' : 'N段階展開'}
        </button>

        <div className="search-box">
          <input
            type="text"
            placeholder="Search class... (Enter: class-centric view)"
            value={searchQuery}
            onChange={e => handleSearch(e.target.value)}
            onKeyDown={handleSearchKeyDown}
            disabled={moduleView}
          />
          {searchQuery && (
            <button onClick={() => handleSearch('')}>✕</button>
          )}
        </div>

        <div className="depth-control">
          <label className="depth-label">深度</label>
          <button
            className="depth-btn"
            onClick={() => handleClassCentricDepthChange(Math.max(1, classCentricDepth - 1))}
            disabled={classCentricDepth <= 1 || moduleView}
          >−</button>
          <span className="depth-value">{classCentricDepth}</span>
          <button
            className="depth-btn"
            onClick={() => handleClassCentricDepthChange(Math.min(5, classCentricDepth + 1))}
            disabled={classCentricDepth >= 5 || moduleView}
          >+</button>
        </div>
      </div>

      <div className="main">
        <div ref={cyRef} className="graph-container" />

        {/* Filter Panel (accordion) */}
        <div className="filter-panel">
          <button
            className="filter-panel-toggle"
            onClick={() => setFilterOpen(f => !f)}
          >
            <span className="filter-panel-title">
              フィルタ
              {relationsLoading && <span className="rel-spinner" />}
            </span>
            <span className="filter-toggle-icon">{filterOpen ? '▲' : '▼'}</span>
          </button>
          {filterOpen && (
            <div className="filter-panel-body">
              {/* 関係性タイプ */}
              <div className="filter-section-label">関係性タイプ</div>
              {REL_TYPES.map(type => (
                <label key={type} className="rel-filter-item">
                  <input
                    type="checkbox"
                    checked={activeRelTypes.has(type)}
                    onChange={() => handleRelTypeToggle(type)}
                    disabled={loading}
                  />
                  <span className="rel-dot" style={{ background: REL_COLORS[type] }} />
                  <span className="rel-label">{type}</span>
                </label>
              ))}

              {/* アーティファクトフィルタ */}
              <div className="filter-section-separator" />
              <div className="filter-section-label">
                アーティファクト
                <span className="filter-node-count">
                  {visibleNodeCount} / {stats?.nodes ?? 0}
                </span>
              </div>
              <div className="artifact-filter-actions">
                <button
                  className="btn-filter-small"
                  onClick={handleArtifactSelectAll}
                  disabled={loading}
                >全選択</button>
                <button
                  className="btn-filter-small"
                  onClick={handleArtifactDeselectAll}
                  disabled={loading}
                >全解除</button>
              </div>
              <div className="artifact-list">
                {artifacts.map(art => (
                  <label key={art.artifactId} className="artifact-filter-item">
                    <input
                      type="checkbox"
                      checked={selectedArtifacts.has(art.artifactId)}
                      onChange={() => handleArtifactToggle(art.artifactId)}
                      disabled={loading}
                    />
                    <span className="legend-dot" style={{ background: hashArtifactColor(art.artifactId) }} />
                    <span className="artifact-filter-name" title={art.artifactId}>
                      {art.artifactId}
                    </span>
                    <span className="artifact-filter-count">
                      ({artifactClassCounts[art.artifactId] || 0})
                    </span>
                  </label>
                ))}
              </div>

              {/* パッケージフィルタ */}
              <div className="filter-section-separator" />
              <div className="filter-section-label">パッケージ</div>
              <div className="package-filter-row">
                <input
                  className="package-filter-input"
                  type="text"
                  placeholder="例: nablarch.fw.web"
                  value={packageFilter}
                  onChange={e => handlePackageFilterChange(e.target.value)}
                  disabled={loading}
                />
                {packageFilter && (
                  <button
                    className="package-filter-clear"
                    onClick={() => handlePackageFilterChange('')}
                  >✕</button>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Module picker overlay — initial UX before any subgraph is rendered */}
        {moduleView && !loading && (
          <div className="module-picker">
            <div className="module-picker-inner">
              <h2 className="module-picker-title">モジュール（アーティファクト）を選択</h2>
              <p className="module-picker-subtitle">
                クラス数: {classesDataRef.current?.nodes.length ?? '?'} ／ アーティファクト数: {artifacts.length}
              </p>
              <input
                type="text"
                className="module-picker-search"
                placeholder="検索: 例 fw-web / testing / core-jdbc"
                value={moduleSearchQuery}
                onChange={e => setModuleSearchQuery(e.target.value)}
                autoFocus
              />
              <div className="module-picker-list">
                {filteredArtifactsForPicker.map(art => (
                  <button
                    key={art.artifactId}
                    className="module-picker-item"
                    onClick={() => enterModuleView(art.artifactId)}
                  >
                    <span className="module-picker-dot" style={{ background: hashArtifactColor(art.artifactId) }} />
                    <span className="module-picker-name">{art.artifactId}</span>
                    <span className="module-picker-count">
                      ({artifactClassCounts[art.artifactId] || 0} classes)
                    </span>
                  </button>
                ))}
                {filteredArtifactsForPicker.length === 0 && (
                  <p className="module-picker-empty">該当するモジュールがありません</p>
                )}
              </div>
              <button
                className="module-picker-full"
                onClick={enterFullView}
                title="全 2127 ノードを描画（描画が重くなります）"
              >
                全て表示（非推奨・低速）
              </button>
            </div>
          </div>
        )}

        {/* Full graph warning banner (C) */}
        {showFullGraphWarning && (
          <div className="full-graph-warning">
            ⚠️ {stats.nodes}ノード全表示中 — 描画が重い場合は「モジュールを変更」ボタンから絞り込みに戻ってください
            <button className="edge-warning-close" onClick={() => setFullGraphWarningDismissed(true)}>✕</button>
          </div>
        )}

        {/* Edge count warning */}
        {edgeWarning && (
          <div className="edge-warning">
            ⚠ 表示エッジ数が5,000件を超えています。描画が重くなる場合があります。
            <button className="edge-warning-close" onClick={() => setEdgeWarning(false)}>✕</button>
          </div>
        )}

        {/* Class-centric view panel */}
        {classCentricMode && (
          <div className="class-centric-panel">
            <div className="class-centric-info">
              <span className="class-centric-icon">🎯</span>
              <span className="class-centric-name">{classCentricFocusId?.split('.').pop()}</span>
              <span className="class-centric-count">{visibleNodeCount} nodes</span>
            </div>
            <div className="class-centric-depth">
              <span className="depth-label-sm">深度</span>
              <button
                className="depth-btn"
                onClick={() => handleClassCentricDepthChange(Math.max(1, classCentricDepth - 1))}
                disabled={classCentricDepth <= 1}
              >−</button>
              <span className="depth-value-sm">{classCentricDepth}</span>
              <button
                className="depth-btn"
                onClick={() => handleClassCentricDepthChange(Math.min(5, classCentricDepth + 1))}
                disabled={classCentricDepth >= 5}
              >+</button>
            </div>
            <button className="btn-exit-centric" onClick={exitClassCentricView}>
              中心ビューを終了
            </button>
          </div>
        )}

        {/* N-level expand controls */}
        {expandMode && !classCentricMode && (
          <div className="expand-panel">
            {!focusNodeId ? (
              <div className="expand-hint">
                ノードをクリックして<br />フォーカスを選択
              </div>
            ) : (
              <>
                <div className="expand-info">
                  <span className="expand-focus-name">{focusNodeId.split('.').pop()}</span>
                  <span className="expand-level-badge">Lv {expandLevel}</span>
                </div>
                <div className="expand-controls">
                  <button className="btn-expand" onClick={handleExpandPlus}>+1レベル展開</button>
                  <button className="btn-expand" onClick={handleExpandMinus}>-1レベル折り畳む</button>
                  <button className="btn-expand" onClick={handleExpandAll}>全展開</button>
                  <button className="btn-expand btn-expand-reset" onClick={handleExpandReset}>リセット</button>
                </div>
              </>
            )}
          </div>
        )}

        {/* Slide-in detail panel — cmd_487 Phase2 (Y) */}
        <div
          className={`detail-panel-slide${selectedNode && !expandMode && !classCentricMode ? ' open' : ''}`}
          aria-hidden={!(selectedNode && !expandMode && !classCentricMode)}
        >
          {selectedNode && (
            <>
              <div className="detail-header" style={{ borderLeftColor: selectedNode.color }}>
                <div className="detail-header-main">
                  <h2 className="detail-simple-name">{selectedNode.fqcn.split('.').pop()}</h2>
                  <span className="detail-type">{selectedNode.type}{selectedNode.isExternal ? ' · external' : ''}</span>
                </div>
                <button
                  className="detail-close-btn"
                  onClick={closeDetailPanel}
                  aria-label="閉じる"
                  title="閉じる (ESC)"
                >×</button>
              </div>
              <div className="detail-body">
                <div className="detail-fqcn">{selectedNode.fqcn}</div>
                <div className="detail-meta-row">
                  <span className="detail-chip" title="Artifact">
                    <span className="detail-chip-dot" style={{ background: selectedNode.color }} />
                    {selectedNode.artifactId}
                  </span>
                  {selectedNode.modifiers.length > 0 && (
                    <span className="detail-chip">{selectedNode.modifiers.join(' ')}</span>
                  )}
                </div>

                <section className="detail-section">
                  <header className="detail-section-header">
                    Fields <span className="detail-count">({selectedNode.fields.length})</span>
                  </header>
                  {selectedNode.fields.length === 0 ? (
                    <div className="detail-empty">なし</div>
                  ) : (
                    <ul className="detail-members">
                      {selectedNode.fields.map((f, i) => (
                        <li key={`f-${i}`} className="detail-member">
                          <span className={`detail-access access-${f.access === '+' ? 'pub' : f.access === '-' ? 'pri' : f.access === '#' ? 'pro' : 'pkg'}`}>{f.access || '+'}</span>
                          {f.isStatic && <span className="detail-static">static</span>}
                          <span className="detail-member-name">{f.name}</span>
                          <span className="detail-member-type">: {f.type}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </section>

                <section className="detail-section">
                  <header className="detail-section-header">
                    Methods <span className="detail-count">({selectedNode.methods.length})</span>
                  </header>
                  {selectedNode.methods.length === 0 ? (
                    <div className="detail-empty">なし</div>
                  ) : (
                    <ul className="detail-members">
                      {selectedNode.methods.map((m, i) => (
                        <li key={`m-${i}`} className="detail-member">
                          <span className={`detail-access access-${m.access === '+' ? 'pub' : m.access === '-' ? 'pri' : m.access === '#' ? 'pro' : 'pkg'}`}>{m.access || '+'}</span>
                          {m.isStatic && <span className="detail-static">static</span>}
                          {m.isAbstract && <span className="detail-abstract">abstract</span>}
                          <span className="detail-member-name">{m.name}</span>
                          <span className="detail-member-params">({(m.params || []).join(', ')})</span>
                          <span className="detail-member-type">: {m.returnType}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </section>

                <section className="detail-section">
                  <header className="detail-section-header">継承関係</header>
                  <div className="detail-rel-block">
                    <div className="detail-rel-label">EXTENDS</div>
                    {selectedNode.extendsTo.length === 0 ? (
                      <div className="detail-empty-inline">—</div>
                    ) : (
                      <ul className="detail-rel-list">
                        {selectedNode.extendsTo.map((id, i) => (
                          <li key={`e-${i}`} className="detail-rel-item" title={id}>{id.split('.').pop()}</li>
                        ))}
                      </ul>
                    )}
                  </div>
                  <div className="detail-rel-block">
                    <div className="detail-rel-label">IMPLEMENTS</div>
                    {selectedNode.implementsTo.length === 0 ? (
                      <div className="detail-empty-inline">—</div>
                    ) : (
                      <ul className="detail-rel-list">
                        {selectedNode.implementsTo.map((id, i) => (
                          <li key={`i-${i}`} className="detail-rel-item" title={id}>{id.split('.').pop()}</li>
                        ))}
                      </ul>
                    )}
                  </div>
                  <div className="detail-rel-block">
                    <div className="detail-rel-label">Subclasses</div>
                    {selectedNode.subclassesOf.length === 0 ? (
                      <div className="detail-empty-inline">—</div>
                    ) : (
                      <ul className="detail-rel-list">
                        {selectedNode.subclassesOf.map((id, i) => (
                          <li key={`s-${i}`} className="detail-rel-item" title={id}>{id.split('.').pop()}</li>
                        ))}
                      </ul>
                    )}
                  </div>
                </section>
              </div>
            </>
          )}
        </div>

        <div className="legend">
          <h3>Artifacts</h3>
          <div className="legend-list">
            {artifacts.map(art => (
              <div key={art.artifactId} className="legend-item">
                <span className="legend-dot" style={{ background: hashArtifactColor(art.artifactId) }} />
                <span className="legend-name">{art.artifactId}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {showAnalyzeModal && (
        <AnalyzeModal
          version=""
          onClose={handleAnalyzeModalClose}
        />
      )}
    </div>
  )
}

export default App
