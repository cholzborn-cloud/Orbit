export class ChatReservations {
  readonly queue = new Map<string, Promise<void>>()
  private readonly listeners = new Set<(chatId: string) => void>()

  // Wird nach jeder Freigabe gerufen (Turn zu Ende); so starten wartende Zustellungen ohne Abfragen.
  onRelease(listener: (chatId: string) => void) {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  reserve(chatId: string): (() => void) | undefined {
    if (this.queue.has(chatId)) return undefined
    let release!: () => void
    const slot = new Promise<void>((resolve) => {
      release = resolve
    })
    this.queue.set(chatId, slot)
    let released = false
    return () => {
      if (released) return
      released = true
      release()
      if (this.queue.get(chatId) === slot) this.queue.delete(chatId)
      for (const listener of this.listeners) {
        try {
          listener(chatId)
        } catch (error) {
          console.error("Freigabe-Hörer fehlgeschlagen:", error)
        }
      }
    }
  }
}
