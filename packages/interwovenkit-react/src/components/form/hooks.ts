import { useEffect, useRef } from "react"
import { useIsMobile } from "@/hooks/useIsMobile"

export function useAutoFocus() {
  const ref = useRef<HTMLInputElement>(null)
  const isSmall = useIsMobile()

  useEffect(() => {
    if (isSmall) return
    ref.current?.focus()
  }, [isSmall])

  return ref
}
