import { createContext, useContext } from "react"

export const PortalContext = createContext<{
  container: HTMLDivElement | null
  setContainer: (container: HTMLDivElement | null) => void
}>(null!)

export function usePortal() {
  const { container } = useContext(PortalContext)
  return container
}

export function usePortalCssVariable(property: string) {
  const portalContainer = usePortal()
  if (!portalContainer) return ""
  return getComputedStyle(portalContainer).getPropertyValue(property)
}
