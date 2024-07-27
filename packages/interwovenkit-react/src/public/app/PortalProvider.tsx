import type { PropsWithChildren } from "react"
import { useState } from "react"
import { PortalContext } from "./PortalContext"

const PortalProvider = ({ children }: PropsWithChildren) => {
  const [container, setContainer] = useState<HTMLDivElement | null>(null)

  return (
    <PortalContext.Provider value={{ container, setContainer }}>{children}</PortalContext.Provider>
  )
}

export default PortalProvider
