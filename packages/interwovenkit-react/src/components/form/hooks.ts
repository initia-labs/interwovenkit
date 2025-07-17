import { useEffect, useRef } from "react"
import { useMediaQuery } from "usehooks-ts"

export function useAutoFocus<T extends HTMLInputElement>() {
  const ref = useRef<T>(null)
  const isSmall = useMediaQuery("(max-width: 576px)")

  useEffect(() => {
    if (isSmall) return
    ref.current?.focus()
  }, [isSmall])

  return ref
}
