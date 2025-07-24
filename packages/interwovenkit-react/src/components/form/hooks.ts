import { useEffect, useRef } from "react"
import { useMediaQuery } from "usehooks-ts"

export function useAutoFocus<T extends HTMLInputElement>() {
  const ref = useRef<T>(null)
  const isSmall = useMediaQuery("(max-width: 576px)")

  useEffect(() => {
    if (isSmall) return
    // wait 250ms to allow transition to complete
    const timeout = setTimeout(() => ref.current?.focus(), 250)
    return () => clearTimeout(timeout)
  }, [isSmall])

  return ref
}
