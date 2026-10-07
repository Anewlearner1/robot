import { useEffect, useState } from 'preact/hooks'
import { RecordPage } from './pages/RecordPage'
import { ProgressPage } from './pages/ProgressPage'

type Route = 'record' | 'progress'

function readRoute(): Route {
  return location.hash === '#/progress' ? 'progress' : 'record'
}

export function App() {
  const [route, setRoute] = useState<Route>(readRoute)
  useEffect(() => {
    const onHash = () => setRoute(readRoute())
    addEventListener('hashchange', onHash)
    return () => removeEventListener('hashchange', onHash)
  }, [])

  return (
    <div class="app">
      <main class="app-main">{route === 'progress' ? <ProgressPage /> : <RecordPage />}</main>
      <nav class="tab-bar">
        <a href="#/" class={route === 'record' ? 'active' : ''}>練唱</a>
        <a href="#/progress" class={route === 'progress' ? 'active' : ''}>進步</a>
      </nav>
    </div>
  )
}
