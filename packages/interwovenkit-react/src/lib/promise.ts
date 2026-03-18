/** Indicates an operation exceeded its time limit. Thrown by {@link withTimeout} and polling-based confirmation loops. */
export class TimeoutError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "TimeoutError"
  }
}

/** Race a promise against a timeout. Cleans up the timer on settlement. */
export function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout>

  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new TimeoutError(message)), ms)
  })

  return Promise.race([promise, timeout]).finally(() => {
    clearTimeout(timer)
  })
}
