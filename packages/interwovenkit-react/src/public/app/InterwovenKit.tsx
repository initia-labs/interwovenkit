import AsyncBoundary from "@/components/AsyncBoundary"
import { MemoryRouter } from "@/lib/router"
import type { FormValues } from "@/pages/bridge/data/form"
import { fullscreenContext } from "./fullscreen"
import Routes from "./Routes"

const InterwovenKit = ({ bridge }: { bridge?: Partial<FormValues> }) => {
  return (
    <MemoryRouter initialEntry={{ path: bridge ? "/bridge" : "/", state: bridge }}>
      <div className="body">
        <fullscreenContext.Provider value={!!bridge}>
          <AsyncBoundary>
            <Routes />
          </AsyncBoundary>
        </fullscreenContext.Provider>
      </div>
    </MemoryRouter>
  )
}

export default InterwovenKit
