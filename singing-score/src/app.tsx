import { useEffect, useState } from 'preact/hooks'
import { RecordPage } from './pages/RecordPage'
import { ProgressPage } from './pages/ProgressPage'

type Route = 'record' | 'progress'

function readRoute(): Route {
  return location.hash === '#/progress' ? 'progress' : 'record'
}

function MicIcon() {
  return (
    <svg class="tab-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true">
      <rect x="9" y="3" width="6" height="11" rx="3" />
      <path d="M5 11a7 7 0 0 0 14 0M12 18v3" />
    </svg>
  )
}

function TrendIcon() {
  return (
    <svg class="tab-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <path d="M3 17l6-6 4 4 8-8M15 7h6v6" />
    </svg>
  )
}

export function App() {
  const [route, setRoute] = useState<Route>(readRoute)
  useEffect(() => {
    const onHash = () => {
      setRoute(readRoute())
      scrollTo(0, 0)
    }
    addEventListener('hashchange', onHash)
    return () => removeEventListener('hashchange', onHash)
  }, [])

  return (
    <div class="app">
      <main class="app-main">{route === 'progress' ? <ProgressPage /> : <RecordPage />}</main>
      <nav class="tab-bar" aria-label="主要分頁">
        <a href="#/" class={route === 'record' ? 'active' : ''} aria-current={route === 'record' ? 'page' : undefined}>
          <MicIcon />
          練唱
        </a>
        <a
          href="#/progress"
          class={route === 'progress' ? 'active' : ''}
          aria-current={route === 'progress' ? 'page' : undefined}
        >
          <TrendIcon />
          進步
        </a>
      </nav>
    </div>
  )
}
