/* eslint-disable no-console */

/**
 * FIXME: When you use Radix UI `DialogContent` inside a shadow dom, the console shows a fake error.
 * There are already many issues and PRs about this, but it still isn't fixed.
 * So we wrote functions to override console.error and hide that one error message.
 * But we can't include this file in production.
 * Those functions catch every error, so when a real error appears it looks like it came from this code
 * and that will make it hard for other developers to debug real errors.
 */

const originalConsoleError = console.error
const originalConsoleWarn = console.warn

const SILENCED_ERROR_PHRASE = "`DialogContent` requires a `DialogTitle`"
const SILENCED_WARN_PHRASE = "Missing `Description`"

console.error = (...args: unknown[]): void => {
  const shouldSilence = args.some(
    (arg): arg is string => typeof arg === "string" && arg.includes(SILENCED_ERROR_PHRASE),
  )
  if (shouldSilence) return
  originalConsoleError(...args)
}

console.warn = (...args: unknown[]): void => {
  const shouldSilence = args.some(
    (arg): arg is string => typeof arg === "string" && arg.includes(SILENCED_WARN_PHRASE),
  )
  if (shouldSilence) return
  originalConsoleWarn(...args)
}
