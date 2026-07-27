import { createContext, useContext } from "react"

export const PageScrollContext = createContext<HTMLDivElement | null>(null)

export function usePageScrollRoot() {
  return useContext(PageScrollContext)
}
