/**
 * Per-thread asynchronous exclusion. One web account serves one conversation at
 * a time, so parallel harness requests must queue instead of interleaving into
 * the same guest page.
 */

/** FIFO mutex keyed by thread id. */
export class SessionLock {
  private readonly tails = new Map<string, Promise<void>>()

  /**
   * Wait for the previous holder of `key` and take the lock.
   * @param key - thread id the lock is scoped to.
   * @returns the release function; calling it twice has no further effect.
   */
  async acquire(key: string): Promise<() => void> {
    const previous = this.tails.get(key) ?? Promise.resolve()
    const { promise: current, resolve: release } = Promise.withResolvers<void>()
    const tail = previous.then(() => current)
    this.tails.set(key, tail)
    await previous
    let released = false
    return () => {
      if (released) return
      released = true
      release()
      if (this.tails.get(key) === tail) this.tails.delete(key)
    }
  }

  /**
   * Run one operation while holding the lock.
   * @param key - thread id the lock is scoped to.
   * @param operation - work to run under the lock.
   * @returns the operation result.
   */
  async run<T>(key: string, operation: () => Promise<T>): Promise<T> {
    const release = await this.acquire(key)
    try {
      return await operation()
    } finally {
      release()
    }
  }

  /** Number of threads currently holding or waiting for the lock. */
  get size(): number {
    return this.tails.size
  }
}
