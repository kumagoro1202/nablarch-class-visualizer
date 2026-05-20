import { useState, useEffect, useRef, useCallback } from 'react'
import cytoscape from 'cytoscape'
import fcose from 'cytoscape-fcose'
import './App.css'

cytoscape.use(fcose)

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
  const [stats, setStats] = useState(null)
  const [versions, setVersions] = useState([])
  const [selectedVersion, setSelectedVersion] = useState(null)
  const [showAnalyzeModal, setShowAnalyzeModal] = useState(false)
  const savedZoom = useRef(null)
  const searchQueryRef = useRef('')

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

  useEffect(() => {
    if (!selectedVersion) return

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
        const [classesRes, relationsRes, artifactsRes] = await Promise.all([
          fetch(`/data/versions/${selectedVersion}/classes.json`),
          fetch(`/data/versions/${selectedVersion}/relations.json`),
          fetch(`/data/versions/${selectedVersion}/artifacts.json`),
        ])

        if (!classesRes.ok) throw new Error(`classes.json: HTTP ${classesRes.status}`)
        if (!relationsRes.ok) throw new Error(`relations.json: HTTP ${relationsRes.status}`)
        if (!artifactsRes.ok) throw new Error(`artifacts.json: HTTP ${artifactsRes.status}`)

        const classesData = await classesRes.json()
        const relationsData = await relationsRes.json()
        const artifactsData = await artifactsRes.json()

        const artMap = {}
        for (const art of artifactsData.artifacts) {
          artMap[art.artifactId] = art.colorHex
        }
        setArtifacts(artifactsData.artifacts)

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

        const edges = relationsData.edges.map((edge, i) => ({
          data: {
            id: `e${i}`,
            source: edge.from,
            target: edge.to,
            relation_type: edge.relation_type,
          },
        }))

        setStats({ nodes: nodes.length, edges: edges.length })
        setLoadingMsg('Running layout (this may take a few seconds)...')

        const cy = cytoscape({
          container: cyRef.current,
          elements: [...nodes, ...edges],
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
              style: {
                'border-width': 3,
                'border-color': '#ffffff',
                'width': 30,
                'height': 30,
              },
            },
            {
              selector: 'node.highlighted',
              style: {
                'border-width': 3,
                'border-color': '#ffff00',
                'width': 28,
                'height': 28,
              },
            },
            {
              selector: 'node.dimmed',
              style: {
                'opacity': 0.15,
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
                'opacity': 0.3,
              },
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
          setSelectedNode({
            fqcn: node.data('fqcn'),
            artifactId: node.data('artifactId'),
            type: node.data('type'),
            modifiers: node.data('modifiers') || [],
            package: node.data('package'),
            color: node.data('color'),
          })
        })

        cy.on('tap', evt => {
          if (evt.target === cy) {
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

  const selectedVersionInfo = versions.find(v => v.version === selectedVersion)

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
          <span className="stats">{stats.nodes} classes · {stats.edges} relations</span>
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

        {selectedNode && (
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
