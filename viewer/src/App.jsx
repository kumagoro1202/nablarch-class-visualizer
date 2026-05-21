import { useState, useEffect } from 'react'
import './App.css'
import ModuleList from './components/ModuleList'
import ClassListByPackage from './components/ClassListByPackage'
import DiagramViewer from './components/DiagramViewer'

function getParams() {
  const sp = new URLSearchParams(window.location.search)
  return {
    module: sp.get('module') || null,
    cls: sp.get('class') || null,
  }
}

function App() {
  const [params, setParams] = useState(getParams)

  useEffect(() => {
    const handler = () => setParams(getParams())
    window.addEventListener('popstate', handler)
    return () => window.removeEventListener('popstate', handler)
  }, [])

  const navigate = (newParams) => {
    const sp = new URLSearchParams()
    if (newParams.module) sp.set('module', newParams.module)
    if (newParams.cls) sp.set('class', newParams.cls)
    const url = sp.toString() ? '?' + sp.toString() : '/'
    history.pushState({}, '', url)
    setParams(newParams)
  }

  if (params.module && params.cls) {
    return <DiagramViewer module={params.module} cls={params.cls} navigate={navigate} />
  }
  if (params.module) {
    return <ClassListByPackage module={params.module} navigate={navigate} />
  }
  return <ModuleList navigate={navigate} />
}

export default App
