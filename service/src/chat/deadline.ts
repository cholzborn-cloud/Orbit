export type ActiveDeadlineOptions = {
  now?: () => number
  setTimer?: (callback: () => void, milliseconds: number) => () => void
}

export class ActiveDeadline {
  private readonly controller = new AbortController()
  readonly signal = this.controller.signal
  private readonly now: () => number
  private readonly setTimer: NonNullable<ActiveDeadlineOptions["setTimer"]>
  private remainingMs: number
  private activeSince: number | undefined
  private cancelTimer: (() => void) | undefined
  private disposed = false

  constructor(milliseconds: number, options: ActiveDeadlineOptions = {}) {
    if (
      !Number.isFinite(milliseconds) ||
      milliseconds < 0 ||
      milliseconds > 2_147_483_647
    )
      throw new RangeError("Ungültiges aktives Zeitlimit.")
    this.remainingMs = milliseconds
    this.now = options.now ?? (() => performance.now())
    this.setTimer =
      options.setTimer ??
      ((callback, ms) => {
        const timer = setTimeout(callback, ms)
        timer.unref()
        return () => clearTimeout(timer)
      })
    this.resume()
  }

  pause(waiting: boolean) {
    if (this.disposed || this.signal.aborted) return
    if (!waiting) {
      if (this.activeSince === undefined) this.resume()
      return
    }
    if (this.activeSince === undefined) return
    this.charge()
    this.cancelTimer?.()
    this.cancelTimer = undefined
    if (this.remainingMs <= 0) this.expire()
  }

  dispose() {
    this.disposed = true
    this.cancelTimer?.()
    this.cancelTimer = undefined
    this.activeSince = undefined
  }

  private charge() {
    if (this.activeSince === undefined) return
    this.remainingMs -= Math.max(0, this.now() - this.activeSince)
    this.activeSince = undefined
  }

  private resume() {
    this.activeSince = this.now()
    this.cancelTimer = this.setTimer(
      () => {
        this.cancelTimer = undefined
        if (this.disposed || this.signal.aborted) return
        this.charge()
        if (this.remainingMs <= 0) this.expire()
        else this.resume()
      },
      Math.max(0, this.remainingMs)
    )
  }

  private expire() {
    this.controller.abort(
      new DOMException(
        "Das aktive Zeitlimit wurde überschritten.",
        "TimeoutError"
      )
    )
  }
}
