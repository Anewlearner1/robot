import { useState } from 'preact/hooks'

const STORAGE_KEY = 'singing-score:tipsDismissed'

function readDismissed(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) === '1'
  } catch {
    return false
  }
}

/** True when running as an installed home-screen app (iOS or standard display-mode). */
export function isStandalone(): boolean {
  const nav = navigator as Navigator & { standalone?: boolean }
  if (nav.standalone) return true
  return typeof matchMedia === 'function' && matchMedia('(display-mode: standalone)').matches
}

function isIOS(): boolean {
  const ua = navigator.userAgent
  return /iPhone|iPad|iPod/.test(ua) || (ua.includes('Macintosh') && navigator.maxTouchPoints > 1)
}

/** First-use tips (PRD F10): sing with headphones or a cappella; add to home screen to keep history. */
export function FirstRunTips() {
  const [dismissed, setDismissed] = useState(readDismissed)
  if (dismissed) return null

  const dismiss = () => {
    setDismissed(true)
    try {
      localStorage.setItem(STORAGE_KEY, '1')
    } catch {
      // Private mode: the tips simply show again next time.
    }
  }

  return (
    <aside class="card tips" aria-label="使用提示">
      <h2 class="section-title">開始前的小提醒</h2>
      <ul class="tips-list">
        <li>
          <strong>戴耳機或清唱：</strong>伴奏從喇叭播出會被麥克風收進去，讓音高偵測出錯。
        </li>
        {!isStandalone() && (
          <li>
            <strong>加入主畫面以保存紀錄：</strong>
            {isIOS()
              ? '在 Safari 點「分享」→「加入主畫面」。沒加入的話，iOS 可能在一段時間後清除紀錄。'
              : '在瀏覽器選單選「安裝應用程式」或「加到主畫面」，紀錄比較不會被清除。'}
          </li>
        )}
        <li>
          <strong>錄音只在手機上分析，</strong>分析完立即丟棄，不會上傳。
        </li>
      </ul>
      <button type="button" class="btn btn-secondary btn-block" onClick={dismiss}>
        知道了
      </button>
    </aside>
  )
}
