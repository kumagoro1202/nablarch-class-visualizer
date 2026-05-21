import { useState, useEffect, useMemo } from 'react'

const PINNED = [
  'nablarch-fw',
  'nablarch-fw-web',
  'nablarch-fw-batch',
  'nablarch-fw-jaxrs',
  'nablarch-core',
  'nablarch-core-jdbc',
  'nablarch-common-dao',
]

export default function ModuleList({ navigate }) {
  const [modules, setModules] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [search, setSearch] = useState('')

  useEffect(() => {
    async function load() {
      try {
        const idxRes = await fetch('/data/versions/index.json')
        if (!idxRes.ok) throw new Error(`index.json: HTTP ${idxRes.status}`)
        const idx = await idxRes.json()
        const versions = (idx.versions || []).filter(v => v.status === 'done')
        if (versions.length === 0) throw new Error('利用可能なバージョンがありません')
        const latest = versions.sort((a, b) =>
          (b.analyzed_at || '').localeCompare(a.analyzed_at || '')
        )[0]
        const clsRes = await fetch(`/data/versions/${latest.version}/classes.json`)
        if (!clsRes.ok) throw new Error(`classes.json: HTTP ${clsRes.status}`)
        const data = await clsRes.json()
        const counts = {}
        for (const node of data.nodes || []) {
          counts[node.artifactId] = (counts[node.artifactId] || 0) + 1
        }
        const list = Object.entries(counts).map(([id, count]) => ({ id, count }))
        list.sort((a, b) => b.count - a.count)
        setModules(list)
      } catch (e) {
        setError(e.message)
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [])

  const filtered = useMemo(() => {
    if (!search.trim()) return modules
    const q = search.toLowerCase()
    return modules.filter(m => m.id.toLowerCase().includes(q))
  }, [modules, search])

  const pinned = filtered.filter(m => PINNED.includes(m.id))
  const others = filtered.filter(m => !PINNED.includes(m.id))

  if (loading) return <div className="loading">データを読み込み中...</div>
  if (error) return <div className="error">エラー: {error}</div>

  return (
    <div className="module-list-page">
      <div className="page-header">
        <h1>Nablarch クラスビューア</h1>
        <p>モジュールを選択してクラス一覧を表示します</p>
      </div>

      <div className="search-bar">
        <input
          type="text"
          placeholder="モジュール名で絞り込み..."
          value={search}
          onChange={e => setSearch(e.target.value)}
          autoFocus
        />
        {search && (
          <button className="clear-btn" onClick={() => setSearch('')}>✕</button>
        )}
      </div>

      {pinned.length > 0 && !search && (
        <section>
          <h2 className="section-title">主要モジュール</h2>
          <div className="module-grid">
            {pinned.map(m => (
              <ModuleCard key={m.id} module={m} onClick={() => navigate({ module: m.id })} pinned />
            ))}
          </div>
        </section>
      )}

      <section>
        <h2 className="section-title">
          {search ? `検索結果 (${filtered.length}件)` : '全モジュール一覧'}
        </h2>
        <div className="module-grid">
          {(search ? filtered : others).map(m => (
            <ModuleCard key={m.id} module={m} onClick={() => navigate({ module: m.id })} />
          ))}
        </div>
        {filtered.length === 0 && (
          <p className="no-results">該当するモジュールがありません</p>
        )}
      </section>
    </div>
  )
}

function ModuleCard({ module, onClick, pinned }) {
  return (
    <button className={`module-card${pinned ? ' pinned' : ''}`} onClick={onClick}>
      <span className="module-name">{module.id}</span>
      <span className="module-count">{module.count} クラス</span>
    </button>
  )
}
