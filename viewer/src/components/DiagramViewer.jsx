import { useState, useEffect, useCallback } from 'react'
import { TransformWrapper, TransformComponent } from 'react-zoom-pan-pinch'

function svgFilePath(version, fqcn) {
  // Files are named encodeURIComponent(fqcn).svg on disk.
  // To fetch a file literally named "foo%241.svg" via HTTP, the URL must contain "%25241"
  // (double-encoded) so the server URL-decodes it back to the literal filename.
  return `/diagrams/${version}/${encodeURIComponent(encodeURIComponent(fqcn))}.svg`
}

export default function DiagramViewer({ module, cls, navigate }) {
  const [svgContent, setSvgContent] = useState(null)
  const [version, setVersion] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    async function load() {
      setLoading(true)
      setError(null)
      setSvgContent(null)
      try {
        const idxRes = await fetch('/data/versions/index.json')
        if (!idxRes.ok) throw new Error(`index.json: HTTP ${idxRes.status}`)
        const idx = await idxRes.json()
        const versions = (idx.versions || []).filter(v => v.status === 'done')
        const latest = versions.sort((a, b) =>
          (b.analyzed_at || '').localeCompare(a.analyzed_at || '')
        )[0]
        setVersion(latest.version)
        const url = svgFilePath(latest.version, cls)
        const svgRes = await fetch(url)
        if (!svgRes.ok) {
          if (svgRes.status === 404) {
            setError(`クラス図が見つかりません: ${cls}`)
          } else {
            throw new Error(`SVG取得失敗: HTTP ${svgRes.status}`)
          }
          return
        }
        const text = await svgRes.text()
        setSvgContent(text)
      } catch (e) {
        setError(e.message)
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [cls])

  const handleContainerClick = useCallback((e) => {
    const anchor = e.target.closest('a')
    if (!anchor) return
    e.preventDefault()
    e.stopPropagation()
    const href = anchor.getAttribute('href') || anchor.getAttributeNS('http://www.w3.org/1999/xlink', 'href')
    if (!href) return
    try {
      const url = new URL(href, window.location.origin)
      const mod = url.searchParams.get('module')
      const cls = url.searchParams.get('class')
      if (mod && cls) {
        navigate({ module: mod, cls })
      }
    } catch {
      // ignore malformed URLs
    }
  }, [navigate])

  const simpleName = cls.split('.').pop()

  return (
    <div className="diagram-viewer-page">
      <div className="page-header">
        <div className="header-nav">
          <button className="back-btn" onClick={() => navigate({ module })}>
            ← クラス一覧に戻る
          </button>
          <button className="back-btn secondary" onClick={() => navigate({})}>
            ← モジュール一覧に戻る
          </button>
        </div>
        <h1>
          <span className="module-badge">{module}</span>
          {simpleName}
        </h1>
        <p className="fqcn">{cls}</p>
      </div>

      <div className="diagram-container">
        {loading && <div className="loading">UMLクラス図を読み込み中...</div>}
        {error && <div className="error">{error}</div>}
        {svgContent && (
          <TransformWrapper
            initialScale={1}
            minScale={0.1}
            maxScale={5}
            centerOnInit
            wheel={{ step: 0.1 }}
          >
            <TransformComponent
              wrapperClass="svg-wrapper"
              contentClass="svg-content"
            >
              <div
                className="svg-inner"
                dangerouslySetInnerHTML={{ __html: svgContent }}
                onClick={handleContainerClick}
              />
            </TransformComponent>
          </TransformWrapper>
        )}
      </div>

      <div className="diagram-hint">
        マウスホイール: ズーム / ドラッグ: パン / クラス名クリック: ジャンプ
      </div>
    </div>
  )
}
