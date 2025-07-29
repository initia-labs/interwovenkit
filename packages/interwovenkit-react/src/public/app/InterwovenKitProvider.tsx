import type { PropsWithChildren } from "react"
import { useEffect } from "react"
import { Tooltip } from "radix-ui"
import { useIsClient } from "usehooks-ts"
import { MemoryRouter } from "@/lib/router"
import { LocalStorageKey } from "@/data/constants"
import { migrateLocalStorage } from "@/data/migration"
import type { Config } from "@/data/config"
import { ConfigContext } from "@/data/config"
import { useInitiaRegistry, useLayer1 } from "@/data/chains"
import AsyncBoundary from "@/components/AsyncBoundary"
import { useSkipChains } from "@/pages/bridge/data/chains"
import { useSkipAssets } from "@/pages/bridge/data/assets"
import { MAINNET } from "../data/constants"
import PortalProvider from "./PortalProvider"
import NotificationProvider from "./NotificationProvider"
import ModalProvider from "./ModalProvider"
import Drawer from "./Drawer"
import Routes from "./Routes"

const ROBOTO_MONO =
  "https://fonts.googleapis.com/css2?family=Roboto+Mono:wght@100..700&display=swap"

const Fonts = () => {
  return (
    <>
      <link rel="preconnect" href="https://fonts.googleapis.com" />
      <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
      <link rel="stylesheet" href={ROBOTO_MONO} />
      <link rel="stylesheet" href="https://assets.initia.xyz/fonts/PilatWide.css" />
    </>
  )
}

// The widget fetches registry information and other essentials before rendering
// its children.  This keeps the UI responsive when the drawer first opens.
const Prefetch = () => {
  useInitiaRegistry()

  // bridge
  const layer1 = useLayer1()
  useSkipChains()
  useSkipAssets(localStorage.getItem(LocalStorageKey.BRIDGE_SRC_CHAIN_ID) ?? layer1.chainId)
  useSkipAssets(localStorage.getItem(LocalStorageKey.BRIDGE_DST_CHAIN_ID) ?? layer1.chainId)

  return null
}

const InterwovenKitProvider = ({ children, ...config }: PropsWithChildren<Partial<Config>>) => {
  useEffect(() => {
    migrateLocalStorage()
  }, [])

  if (!useIsClient()) {
    return null
  }

  return (
    <>
      <Fonts />

      <ConfigContext.Provider value={{ ...MAINNET, ...config }}>
        <AsyncBoundary suspenseFallback={null} errorBoundaryProps={{ fallback: null }}>
          <Prefetch />
        </AsyncBoundary>

        <MemoryRouter>
          <PortalProvider>
            <Tooltip.Provider delayDuration={0} skipDelayDuration={0}>
              <NotificationProvider>
                <ModalProvider>
                  {children}

                  <Drawer>
                    <Routes />
                  </Drawer>
                </ModalProvider>
              </NotificationProvider>
            </Tooltip.Provider>
          </PortalProvider>
        </MemoryRouter>
      </ConfigContext.Provider>
    </>
  )
}

export default InterwovenKitProvider
