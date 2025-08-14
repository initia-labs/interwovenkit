import { createContext, useContext, type RefObject } from "react"

export const ScrollableContext = createContext<RefObject<HTMLDivElement | null>>(null!)

export function useScrollableRef() {
  return useContext(ScrollableContext)
}
