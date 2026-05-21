import { useState, useEffect, useCallback, useRef } from 'react'
import { TransformWrapper, TransformComponent } from 'react-zoom-pan-pinch'

function svgFilePath(version, fqcn) {
  // Files are named encodeURIComponent(fqcn).svg on disk.
  // To fetch a file literally named "foo%241.svg" via HTTP, the URL must contain "%25241"
  // (double-encoded) so the server URL-decodes it back to the literal filename.
  return `/diagrams/${version}/${encodeURIComponent(encodeURIComponent(fqcn))}.svg`
}

// PlantUML assigns id="C_<fqcn with [.$] replaced by _>" to each class rect group.
function targetElementId(fqcn) {
  return 'C_' + fqcn.replace(/[.$]/g, '_')
}

// PlantUML highlight fill for the "current/main" class (LightYellow variants).
const HIGHLIGHT_FILLS = ['#FFFFE0', '#FFFACD']

const INITIAL_SCALE = 2.5
const MIN_SCALE = 0.25
const MAX_SCALE = 8
const BASE_WHEEL_STEP = 0.005
const ZOOM_SPEED_STORAGE_KEY = 'diagramZoomSpeed'

export default function DiagramViewer({ module, cls, navigate }) {
  const [svgContent, setSvgContent] = useState(null)
  const [version, setVersion] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [zoomSpeed, setZoomSpeed] = useState(() => {
    const saved = localStorage.getItem(ZOOM_SPEED_STORAGE_KEY)
    const n = saved ? parseFloat(saved) : NaN
    return Number.isFinite(n) && n >= 0.1 && n <= 2.0 ? n : 0.6
  })
  const transformApiRef = useRef(null)
  const svgContainerRef = useRef(null)

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

  // After SVG renders, zoom-and-center on the main class element so it occupies
  // roughly 1/4–1/5 of the viewport instead of the default tiny fit-to-canvas view.
  useEffect(() => {
    if (!svgContent) return
    const raf = requestAnimationFrame(() => {
      const api = transformApiRef.current
      const container = svgContainerRef.current
      if (!api || !container) return

      const svgEl = container.querySelector('svg')
      if (!svgEl) return

      const expectedId = targetElementId(cls)
      let target = null
      try {
        target = svgEl.querySelector(`#${CSS.escape(expectedId)}`)
      } catch {
        // CSS.escape unavailable or selector invalid — ignore.
      }
      if (!target) {
        for (const fill of HIGHLIGHT_FILLS) {
          target = svgEl.querySelector(`[fill="${fill}"]`)
          if (target) break
        }
      }

      if (target && typeof api.zoomToElement === 'function') {
        // scale=3 keeps neighbour classes visible at screen edges while making
        // the central class occupy ~1/4 of the viewport for most diagrams.
        api.zoomToElement(target, 3, 200)
      } else if (typeof api.setTransform === 'function') {
        api.setTransform(0, 0, INITIAL_SCALE, 200)
      }
    })
    return () => cancelAnimationFrame(raf)
  }, [svgContent, cls])

  const handleZoomSpeedChange = useCallback((e) => {
    const value = parseFloat(e.target.value)
    if (!Number.isFinite(value)) return
    setZoomSpeed(value)
    localStorage.setItem(ZOOM_SPEED_STORAGE_KEY, String(value))
  }, [])

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
        <div className="diagram-zoom-speed-control">
          <label className="diagram-zoom-speed-label" htmlFor="diagram-zoom-speed-slider">
            ズーム速度
          </label>
          <input
            id="diagram-zoom-speed-slider"
            type="range"
            min="0.1"
            max="2.0"
            step="0.1"
            value={zoomSpeed}
            onChange={handleZoomSpeedChange}
            className="diagram-zoom-speed-slider"
          />
          <span className="diagram-zoom-speed-value">{zoomSpeed.toFixed(1)}x</span>
        </div>
        {loading && <div className="loading">UMLクラス図を読み込み中...</div>}
        {error && <div className="error">{error}</div>}
        {svgContent && (
          <TransformWrapper
            ref={transformApiRef}
            initialScale={INITIAL_SCALE}
            minScale={MIN_SCALE}
            maxScale={MAX_SCALE}
            centerOnInit
            wheel={{ step: BASE_WHEEL_STEP * zoomSpeed, smoothStep: 0.001 }}
            panning={{ velocityDisabled: true }}
          >
            <TransformComponent
              wrapperClass="svg-wrapper"
              contentClass="svg-content"
            >
              <div
                ref={svgContainerRef}
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
