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

const calcZoomBase = (zoom) => {
  if (zoom < 0.3) return 0.5
  if (zoom < 1.0) return 0.3
  return 0.15
}

// Returns the first 3 package segments as a group key
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

  // Apply artifact + package filter to nodes (no-op in expand mode or compound mode)
  const applyNodeFilter = useCallback(() => {
    const cy = cyInstance.current
    if (!cy || expandModeRef.current || lodCompoundModeRef.current) return

    const selArt = selectedArtifactsRef.current
    const pkgFilter = packageFilterRef.current.toLowerCase().trim()
    const compoundIds = compoundNodeIdsRef.current

    cy.batch(() => {
      cy.nodes().forEach(node => {
        if (compoundIds.has(node.id())) return
        const artMatch = selArt.has(node.data('artifactId'))
        const fqcn = (node.data('fqcn') || '').toLowerCase()
        const pkgMatch = !pkgFilter || fqcn.startsWith(pkgFilter)
        node.style('display', artMatch && pkgMatch ? 'element' : 'none')
      })
      cy.edges().forEach(edge => {
        if (compoundIds.has(edge.source().id()) || compoundIds.has(edge.target().id())) return
        const srcHidden = edge.source().style('display') === 'none'
        const tgtHidden = edge.target().style('display') === 'none'
        edge.style('display', srcHidden || tgtHidden ? 'none' : 'element')
      })
    })

    const visible = cy.nodes().filter(n => !compoundIds.has(n.id()) && n.style('display') !== 'none').length
    setVisibleNodeCount(visible)
  }, [])

  // Enter LOD compound mode: fold class nodes into package group summary nodes
  const enterLODCompound = useCallback(() => {
    const cy = cyInstance.current
    if (!cy || lodCompoundModeRef.current || expandModeRef.current) return

    const t0 = performance.now()
    lodCompoundModeRef.current = true
    setLodCompoundMode(true)

    // Build package groups from currently visible class nodes
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

      // If expand mode active, hide edges that aren't between visible nodes
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
    // Re-apply node filters so edges connecting hidden nodes stay hidden
    applyNodeFilter()
  }, [buildAdjacency, applyNodeFilter])

  // Handle relation type checkbox toggle — loads relations.json on first interaction
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
    // Reset compound mode state on version change
    lodCompoundModeRef.current = false
    setLodCompoundMode(false)
    compoundNodeIdsRef.current = new Set()

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

        // Compute class counts per artifact
        const counts = {}
        for (const node of classesData.nodes) {
          counts[node.artifactId] = (counts[node.artifactId] || 0) + 1
        }
        setArtifactClassCounts(counts)

        // Initialize artifact filter with all artifacts selected
        const allArtIds = new Set(artifactsData.artifacts.map(a => a.artifactId))
        setArtifacts(artifactsData.artifacts)
        setSelectedArtifacts(allArtIds)
        selectedArtifactsRef.current = allArtIds

        setStats({ nodes: classesData.nodes.length, edges: null })
        setVisibleNodeCount(classesData.nodes.length)
        setLoadingMsg(`Building graph (${classesData.nodes.length} nodes)...`)

        const nodes = classesData.nodes.map(node => ({
          data: {
            id: node.id,
            label: node.simpleName,
            fqcn: node.fqcn,
            artifactId: node.artifactId,
            type: node.type,
            modifiers: node.modifiers,
            package: node.package,
            color: hashArtifactColor(node.artifactId),
            isCompound: false,
          },
        }))

        setLoadingMsg('Running layout (this may take a few seconds)...')

        const cy = cytoscape({
          container: cyRef.current,
          elements: nodes,
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
                'width': 20,
                'height': 20,
                'text-outline-width': 1,
                'text-outline-color': '#000000',
                'text-opacity': 0,
              },
            },
            {
              selector: 'node:selected',
              style: { 'border-width': 3, 'border-color': '#ffffff', 'width': 30, 'height': 30 },
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
              // LOD compound summary nodes (package group)
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
          // Apply text-opacity only to class nodes (not compound summary nodes)
          if (!lodCompoundModeRef.current) {
            cy.nodes().style('text-opacity', zoom >= LOD_COMPOUND_THRESHOLD ? 1 : 0)
          }
          updateZoomSensitivity(zoom, speedMultiplierRef.current)

          // LOD compound node toggle (disabled in expand mode)
          if (!expandModeRef.current) {
            if (zoom < LOD_COMPOUND_THRESHOLD && !lodCompoundModeRef.current) {
              enterLODCompound()
            } else if (zoom >= LOD_COMPOUND_THRESHOLD && lodCompoundModeRef.current) {
              exitLODCompound()
            }
          }
        })

        cy.on('tap', 'node', evt => {
          const node = evt.target
          // Ignore taps on compound summary nodes
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
              cy.nodes().removeClass('artifact-peer')
              cy.nodes().filter(n => n.data('artifactId') === artifactId && !n.data('isCompound'))
                .addClass('artifact-peer')
              const connectedEdges = node.connectedEdges()
              cy.edges().removeClass('active-edge inactive-edge')
              connectedEdges.addClass('active-edge')
              cy.edges().not(connectedEdges).addClass('inactive-edge')
            })
            setSelectedNode({
              fqcn: node.data('fqcn'),
              artifactId: node.data('artifactId'),
              type: node.data('type'),
              modifiers: node.data('modifiers') || [],
              package: node.data('package'),
              color: node.data('color'),
            })
          }
        })

        cy.on('tap', evt => {
          if (evt.target === cy && !expandModeRef.current) {
            setSelectedNode(null)
            cy.batch(() => {
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

        const t_layout_start = performance.now()
        const layout = cy.layout({
          name: 'fcose',
          animate: true,
          animationDuration: 2000,
          animationEasing: 'ease-out',
          randomize: true,
          idealEdgeLength: 80,
          nodeRepulsion: 8000,
          numIter: 5000,
          tile: false,
          gravity: 0.25,
          gravityRangeCompound: 1.5,
          initialEnergyOnIncremental: 0.3,
        })

        layout.one('layoutready', () => {
          setLoading(false)
        })

        layout.one('layoutstop', () => {
          const t_layout_done = performance.now()
          console.log(`[Bench] Layout: ${(t_layout_done - t_layout_start).toFixed(1)}ms`)
          console.log(`[Bench] Total initial load: ${(t_layout_done - t_start).toFixed(1)}ms`)

          if (savedZoom.current !== null) {
            cy.zoom(savedZoom.current)
            savedZoom.current = null
          }
          updateZoomSensitivity(cy.zoom(), speedMultiplierRef.current)
          if (searchQueryRef.current) {
            const lq = searchQueryRef.current.toLowerCase()
            const matched = cy.nodes().filter(n =>
              n.data('fqcn').toLowerCase().includes(lq) ||
              n.data('label').toLowerCase().includes(lq)
            )
            if (matched.length > 0) {
              cy.nodes().addClass('dimmed').removeClass('highlighted')
              matched.removeClass('dimmed').addClass('highlighted')
              cy.fit(matched, 80)
            }
          }
        })

        layout.run()
      } catch (err) {
        setLoadingMsg(`Error loading data: ${err.message}`)
        setLoading(false)
      }
    }

    loadData()
  }, [selectedVersion, enterLODCompound, exitLODCompound])

  // Toggle N-level expand mode
  const handleToggleExpandMode = useCallback(async () => {
    const cy = cyInstance.current
    if (!cy) return

    // Exit compound mode first if active
    if (lodCompoundModeRef.current) {
      exitLODCompound()
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
      // Re-apply artifact/package filters after exiting expand mode
      applyNodeFilter()
    } else {
      setExpandMode(true)
      expandModeRef.current = true
      setFocusNodeId(null)
      setExpandLevel(0)
      expandRingsRef.current = []
      setSelectedNode(null)
      // Pre-load relations for expand mode BFS
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
    // Re-apply artifact/package filters after exiting expand mode
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
    const matched = cy.nodes().filter(n =>
      n.data('fqcn').toLowerCase().includes(lq) ||
      n.data('label').toLowerCase().includes(lq)
    )

    if (matched.length === 0) {
      cy.nodes().removeClass('highlighted dimmed')
      return
    }

    cy.nodes().addClass('dimmed').removeClass('highlighted')
    matched.removeClass('dimmed').addClass('highlighted')
    cy.fit(matched, 80)
  }, [])

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
        {stats && (
          <span className="stats">
            {stats.nodes} classes
            {stats.edges != null ? ` · ${stats.edges} relations` : ''}
          </span>
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

        <button
          className={`btn-expand-mode${expandMode ? ' active' : ''}`}
          onClick={handleToggleExpandMode}
          disabled={loading}
          title="N段階展開モード"
        >
          {expandMode ? '展開モード ON' : 'N段階展開'}
        </button>

        <div className="search-box">
          <input
            type="text"
            placeholder="Search class name..."
            value={searchQuery}
            onChange={e => handleSearch(e.target.value)}
          />
          {searchQuery && (
            <button onClick={() => handleSearch('')}>✕</button>
          )}
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

        {/* Edge count warning */}
        {edgeWarning && (
          <div className="edge-warning">
            ⚠ 表示エッジ数が5,000件を超えています。描画が重くなる場合があります。
            <button className="edge-warning-close" onClick={() => setEdgeWarning(false)}>✕</button>
          </div>
        )}

        {/* N-level expand controls */}
        {expandMode && (
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

        {selectedNode && !expandMode && (
          <div className="detail-panel">
            <div className="detail-header" style={{ borderLeftColor: selectedNode.color }}>
              <h2>{selectedNode.fqcn.split('.').pop()}</h2>
              <span className="detail-type">{selectedNode.type}</span>
            </div>
            <div className="detail-body">
              <div className="detail-row">
                <span className="detail-label">FQCN</span>
                <span className="detail-value fqcn">{selectedNode.fqcn}</span>
              </div>
              <div className="detail-row">
                <span className="detail-label">Artifact</span>
                <span className="detail-value">{selectedNode.artifactId}</span>
              </div>
              <div className="detail-row">
                <span className="detail-label">Package</span>
                <span className="detail-value">{selectedNode.package}</span>
              </div>
              {selectedNode.modifiers.length > 0 && (
                <div className="detail-row">
                  <span className="detail-label">Modifiers</span>
                  <span className="detail-value">{selectedNode.modifiers.join(', ')}</span>
                </div>
              )}
            </div>
          </div>
        )}

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
