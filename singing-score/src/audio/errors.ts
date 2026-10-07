/** Why the microphone could not be opened. */
export type MicErrorReason =
  /** User or browser policy denied permission (NotAllowedError / SecurityError). */
  | 'denied'
  /** No microphone found, or it can't satisfy the request (NotFoundError / OverconstrainedError). */
  | 'no-device'
  /** Mic exists but is busy / failed to start, e.g. during a phone call (NotReadableError / AbortError). */
  | 'busy'
  /** Page is not a secure context (http://), so navigator.mediaDevices is missing. */
  | 'insecure'
  /** Browser lacks getUserMedia or Web Audio entirely. */
  | 'unsupported'

/** Mic could not be opened: user denied, no mic, mic busy, insecure context or unsupported browser. */
export class MicPermissionError extends Error {
  readonly reason: MicErrorReason

  constructor(message?: string, reason: MicErrorReason = 'denied', options?: { cause?: unknown }) {
    super(message ?? 'Microphone unavailable', options)
    this.name = 'MicPermissionError'
    this.reason = reason
  }
}

/** Map a getUserMedia rejection to a MicPermissionError (non-media errors are returned unchanged). */
export function toMicError(err: unknown): unknown {
  if (err instanceof MicPermissionError) return err
  const name = typeof err === 'object' && err !== null && 'name' in err ? String((err as { name: unknown }).name) : ''
  const msg = err instanceof Error ? err.message : String(err)
  switch (name) {
    case 'NotAllowedError':
    case 'PermissionDeniedError': // legacy Chrome
    case 'SecurityError':
      return new MicPermissionError(msg || 'Microphone permission denied', 'denied', { cause: err })
    case 'NotFoundError':
    case 'DevicesNotFoundError': // legacy Chrome
    case 'OverconstrainedError':
    case 'ConstraintNotSatisfiedError':
      return new MicPermissionError(msg || 'No microphone found', 'no-device', { cause: err })
    case 'NotReadableError':
    case 'TrackStartError': // legacy Chrome
    case 'AbortError':
      return new MicPermissionError(msg || 'Microphone is busy', 'busy', { cause: err })
    case 'TypeError':
      // e.g. getUserMedia called with an empty constraints object, or unsupported
      return new MicPermissionError(msg || 'getUserMedia unsupported', 'unsupported', { cause: err })
    default:
      return err
  }
}
