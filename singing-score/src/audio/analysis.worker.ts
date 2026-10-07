// Module worker: runs the (synchronous, CPU-heavy) analysis pipeline off the main thread.
import { analyze } from '../pipeline'
import { handleMessage, type AnalyzeResponse } from './worker-protocol'

addEventListener('message', (e: MessageEvent<unknown>) => {
  const res: AnalyzeResponse = handleMessage(e.data, analyze)
  postMessage(res)
})
