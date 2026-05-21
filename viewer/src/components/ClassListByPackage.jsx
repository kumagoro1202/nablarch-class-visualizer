import { useState, useEffect, useMemo } from 'react'

function buildPackageTree(nodes) {
  const tree = {}
  for (const node of nodes) {
    const pkg = node.package || '(デフォルトパッケージ)'
    if (!tree[pkg]) tree[pkg] = []
    tree[pkg].push(node)
  }
  const sorted = Object.entries(tree).sort(([a], [b]) => a.localeCompare(b))
  return sorted.map(([pkg, classes]) => ({
    pkg,
    classes: classes.sort((a, b) => a.simpleName.localeCompare(b.simpleName)),
  }))
}

export default function ClassListByPackage({ module, navigate }) {
  const [allNodes, setAllNodes] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [search, setSearch] = useState('')
  const [collapsed, setCollapsed] = useState(new Set())

  useEffect(() => {
    async function load() {
      try {
        const idxRes = await fetch('/data/versions/index.json')
        if (!idxRes.ok) throw new Error(`index.json: HTTP ${idxRes.status}`)
        const idx = await idxRes.json()
        const versions = (idx.versions || []).filter(v => v.status === 'done')
        const latest = versions.sort((a, b) =>
          (b.analyzed_at || '').localeCompare(a.analyzed_at || '')
        )[0]
        const clsRes = await fetch(`/data/versions/${latest.version}/classes.json`)
        if (!clsRes.ok) throw new Error(`classes.json: HTTP ${clsRes.status}`)
        const data = await clsRes.json()
        const nodes = (data.nodes || []).filter(n => n.artifactId === module)
        setAllNodes(nodes)
      } catch (e) {
        setError(e.message)
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [module])

  const filtered = useMemo(() => {
    if (!search.trim()) return allNodes
    const q = search.toLowerCase()
    return allNodes.filter(n =>
      n.simpleName.toLowerCase().includes(q) || n.fqcn.toLowerCase().includes(q)
    )
  }, [allNodes, search])

  const packageGroups = useMemo(() => buildPackageTree(filtered), [filtered])

  const togglePackage = (pkg) => {
    setCollapsed(prev => {
      const next = new Set(prev)
      if (next.has(pkg)) next.delete(pkg)
      else next.add(pkg)
      return next
    })
  }

  if (loading) return <div className="loading">データを読み込み中...</div>
  if (error) return <div className="error">エラー: {error}</div>

  return (
    <div className="class-list-page">
      <div className="page-header">
        <button className="back-btn" onClick={() => navigate({})}>
          ← モジュール一覧に戻る
        </button>
        <h1>{module} <span className="count-badge">{allNodes.length} クラス</span></h1>
      </div>

      <div className="search-bar">
        <input
          type="text"
          placeholder="クラス名で絞り込み..."
          value={search}
          onChange={e => setSearch(e.target.value)}
          autoFocus
        />
        {search && (
          <button className="clear-btn" onClick={() => setSearch('')}>✕</button>
        )}
      </div>

      {search && (
        <p className="result-count">
          {filtered.length} / {allNodes.length} クラスを表示
        </p>
      )}

      <div className="package-tree">
        {packageGroups.map(({ pkg, classes }) => (
          <div key={pkg} className="package-group">
            <button
              className="package-header"
              onClick={() => togglePackage(pkg)}
            >
              <span className="chevron">{collapsed.has(pkg) ? '▶' : '▼'}</span>
              <span className="pkg-name">{pkg}</span>
              <span className="pkg-count">{classes.length}</span>
            </button>
            {!collapsed.has(pkg) && (
              <ul className="class-items">
                {classes.map(cls => (
                  <li key={cls.fqcn}>
                    <button
                      className="class-item"
                      onClick={() => navigate({ module, cls: cls.fqcn })}
                    >
                      <span className="class-type-badge" data-type={cls.type}>
                        {cls.type === 'INTERFACE' ? 'I' : cls.type === 'ENUM' ? 'E' : 'C'}
                      </span>
                      <span className="class-name">{cls.simpleName}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        ))}
        {packageGroups.length === 0 && (
          <p className="no-results">該当するクラスがありません</p>
        )}
      </div>
    </div>
  )
}
