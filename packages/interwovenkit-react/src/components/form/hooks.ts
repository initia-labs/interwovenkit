import { useEffect, useRef } from "react"
import { useIsMobile } from "@/hooks/useIsMobile"

export function useAutoFocus<T extends HTMLInputElement>() {
  const ref = useRef<T>(null)
  const isSmall = useIsMobile()

  useEffect(() => {
    if (isSmall) return
    ref.current?.focus()
  }, [isSmall])

  return ref
}
