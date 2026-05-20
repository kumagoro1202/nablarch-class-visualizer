import { useState, useEffect, useRef, useCallback } from 'react'
import cytoscape from 'cytoscape'
import fcose from 'cytoscape-fcose'
import './App.css'

cytoscape.use(fcose)

function App() {
  const cyRef = useRef(null)
  const cyInstance = useRef(null)
  const [loading, setLoading] = useState(true)
  const [loadingMsg, setLoadingMsg] = useState('Loading data...')
  const [selectedNode, setSelectedNode] = useState(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [artifacts, setArtifacts] = useState([])
  const [stats, setStats] = useState(null)

  useEffect(() => {
    async function loadData() {
      try {
        setLoadingMsg('Loading class data...')
        const [classesRes, relationsRes, artifactsRes] = await Promise.all([
          fetch('/data/versions/v6u3/classes.json'),
          fetch('/data/versions/v6u3/relations.json'),
          fetch('/data/versions/v6u3/artifacts.json'),
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
          setLoading(false)
        })

        layout.run()
      } catch (err) {
        setLoadingMsg(`Error loading data: ${err.message}`)
      }
    }

    loadData()
  }, [])

  const handleSearch = useCallback((query) => {
    setSearchQuery(query)
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
    </div>
  )
}

export default App
