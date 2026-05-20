import { useState, useEffect, useRef, useCallback } from 'react'
import cytoscape from 'cytoscape'
import fcose from 'cytoscape-fcose'
import './App.css'

cytoscape.use(fcose)

const REL_TYPES = ['EXTENDS', 'IMPLEMENTS', 'USES', 'CONTAINS', 'DEPENDS']
const REL_COLORS = {
  EXTENDS: '#4e79a7',
  IMPLEMENTS: '#76b7b2',
  USES: '#f28e2b',
  CONTAINS: '#59a14f',
  DEPENDS: '#e15759',
}
const DEFAULT_ACTIVE_TYPES = new Set(['EXTENDS', 'IMPLEMENTS'])
const EDGE_WARNING_THRESHOLD = 5000

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

  // Apply artifact + package filter to nodes (no-op in expand mode)
  const applyNodeFilter = useCallback(() => {
    const cy = cyInstance.current
    if (!cy || expandModeRef.current) return

    const selArt = selectedArtifactsRef.current
    const pkgFilter = packageFilterRef.current.toLowerCase().trim()

    cy.batch(() => {
      cy.nodes().forEach(node => {
        const artMatch = selArt.has(node.data('artifactId'))
        const fqcn = (node.data('fqcn') || '').toLowerCase()
        const pkgMatch = !pkgFilter || fqcn.startsWith(pkgFilter)
        node.style('display', artMatch && pkgMatch ? 'element' : 'none')
      })
      cy.edges().forEach(edge => {
        const srcHidden = edge.source().style('display') === 'none'
        const tgtHidden = edge.target().style('display') === 'none'
        edge.style('display', srcHidden || tgtHidden ? 'none' : 'element')
      })
    })

    const visible = cy.nodes().filter(n => n.style('display') !== 'none').length
    setVisibleNodeCount(visible)
  }, [])

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

    async function loadData() {
      if (cyInstance.current) {
        savedZoom.current = cyInstance.current.zoom()
        cyInstance.current.destroy()
        cyInstance.current = null
      }
      setLoading(true)
      setSelectedNode(null)
      setLoadingMsg('Loading class data...')

      try {
        const [classesRes, artifactsRes] = await Promise.all([
          fetch(`/data/versions/${selectedVersion}/classes.json`),
          fetch(`/data/versions/${selectedVersion}/artifacts.json`),
        ])
        if (!classesRes.ok) throw new Error(`classes.json: HTTP ${classesRes.status}`)
        if (!artifactsRes.ok) throw new Error(`artifacts.json: HTTP ${artifactsRes.status}`)

        const classesData = await classesRes.json()
        const artifactsData = await artifactsRes.json()

        const artMap = {}
        for (const art of artifactsData.artifacts) {
          artMap[art.artifactId] = art.colorHex
        }

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
            color: artMap[node.artifactId] || '#888888',
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
              selector: 'edge',
              style: {
                'width': 1,
                'line-color': '#444',
                'target-arrow-color': '#444',
                'target-arrow-shape': 'triangle',
                'curve-style': 'bezier',
                'opacity': 0.4,
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

        cy.on('zoom', () => {
          const zoom = cy.zoom()
          cy.nodes().style('text-opacity', zoom >= 0.3 ? 1 : 0)
        })

        cy.on('tap', 'node', evt => {
          const node = evt.target
          if (expandModeRef.current) {
            const nodeId = node.id()
            setFocusNodeId(nodeId)
            setExpandLevel(0)
            expandRingsRef.current = [new Set([nodeId])]
            cy.batch(() => {
              cy.nodes().style('display', 'none').removeClass('focus highlighted dimmed')
              cy.edges().style('display', 'none')
              node.style('display', 'element').addClass('focus')
            })
          } else {
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
          }
        })

        const layout = cy.layout({
          name: 'fcose',
          animate: false,
          randomize: true,
          idealEdgeLength: 50,
          nodeRepulsion: 4500,
          numIter: 2500,
          tile: true,
          tilingPaddingVertical: 10,
          tilingPaddingHorizontal: 10,
        })

        layout.one('layoutstop', () => {
          if (savedZoom.current !== null) {
            cy.zoom(savedZoom.current)
            savedZoom.current = null
          }
          setLoading(false)
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
  }, [selectedVersion])

  // Toggle N-level expand mode
  const handleToggleExpandMode = useCallback(async () => {
    const cy = cyInstance.current
    if (!cy) return
    if (expandModeRef.current) {
      setExpandMode(false)
      expandModeRef.current = false
      setFocusNodeId(null)
      setExpandLevel(0)
      expandRingsRef.current = []
      cy.batch(() => {
        cy.nodes().style('display', 'element').removeClass('focus highlighted dimmed')
        cy.edges().style('display', 'element')
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
  }, [loadRelations, applyEdgeFilter, applyNodeFilter])

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
      cy.nodes().style('display', 'element').removeClass('focus highlighted dimmed')
      cy.edges().style('display', 'element')
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
                    <span className="legend-dot" style={{ background: art.colorHex }} />
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
                <span className="legend-dot" style={{ background: art.colorHex }} />
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
