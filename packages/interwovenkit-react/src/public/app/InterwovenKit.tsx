import { type PropsWithChildren, useContext } from "react"
import AsyncBoundary from "@/components/AsyncBoundary"
import { MemoryRouter } from "@/lib/router"
import type { FormValues } from "@/pages/bridge/data/form"
import { fullscreenContext } from "./fullscreen"
import { PortalContext } from "./PortalContext"
import PortalProvider from "./PortalProvider"
import Routes from "./Routes"

const PortalContainer = ({ children }: PropsWithChildren) => {
  const { setContainer } = useContext(PortalContext)
  return (
    <div className="body" ref={setContainer}>
      {children}
    </div>
  )
}

const InterwovenKit = ({ bridge }: { bridge?: Partial<FormValues> }) => {
  return (
    <MemoryRouter initialEntry={{ path: bridge ? "/bridge" : "/", state: bridge }}>
      <PortalProvider>
        <PortalContainer>
          <fullscreenContext.Provider value={!!bridge}>
            <AsyncBoundary>
              <Routes />
            </AsyncBoundary>
          </fullscreenContext.Provider>
        </PortalContainer>
      </PortalProvider>
    </MemoryRouter>
  )
}

export default InterwovenKit
