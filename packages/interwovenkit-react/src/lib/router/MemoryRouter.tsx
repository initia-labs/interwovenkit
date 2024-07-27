import { adjust, take } from "ramda"
import type { PropsWithChildren } from "react"
import { useCallback, useState } from "react"

// A deliberately lightweight router used by the widget.  It keeps navigation
// history entirely in memory so we don't interfere with the host application's
// URL or history state.  Each navigation pushes or truncates this local array.
import type { HistoryEntry } from "./RouterContext"
import { RouterContext } from "./RouterContext"

interface MemoryRouterProps {
  initialEntry?: HistoryEntry
}

const MemoryRouter = ({ children, initialEntry }: PropsWithChildren<MemoryRouterProps>) => {
  const [history, setHistory] = useState<HistoryEntry[]>([initialEntry ?? { path: "/" }])
  const location = history[history.length - 1]

  const navigate = useCallback((to: string | number, state?: object) => {
    setHistory((prev) => {
      if (typeof to === "string") {
        return [...prev, { path: to, state }]
      }

      // When `to` is a number we treat it like `history.go()` in the browser.
      // A negative value goes back N entries while a positive value would move
      // forward (unused here but handled for completeness).
      const newLength = prev.length + to
      if (newLength < 1) return prev

      // Drop any entries beyond the new length to mimic browser history
      const truncated = take(newLength, prev)

      if (state !== undefined) {
        // Replace the state of the final entry if provided
        return adjust(newLength - 1, (entry) => ({ ...entry, state }), truncated)
      }

      return truncated
    })
  }, [])

  const reset = useCallback((path: string, state?: object) => {
    setHistory([{ path, state }])
  }, [])

  return (
    <RouterContext.Provider value={{ location, history, navigate, reset }}>
      {children}
    </RouterContext.Provider>
  )
}

export default MemoryRouter
