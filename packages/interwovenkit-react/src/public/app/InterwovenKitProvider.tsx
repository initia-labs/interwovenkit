import { Tooltip } from "radix-ui"
import { useEffect } from "react"
import { useIsClient } from "usehooks-ts"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import AsyncBoundary from "@/components/AsyncBoundary"
import { useInitiaRegistry, useLayer1 } from "@/data/chains"
import type { Config } from "@/data/config"
import { ConfigContext } from "@/data/config"
import { LocalStorageKey } from "@/data/constants"
import { migrateLocalStorage } from "@/data/migration"
import { InjectWagmiConnector } from "@/lib/privy/InjectWagmiConnector"
import { MemoryRouter } from "@/lib/router"
import { useInitializeAutoSign } from "@/pages/autosign/data/hooks"
import { useSkipAssets } from "@/pages/bridge/data/assets"
import { useSkipChains } from "@/pages/bridge/data/chains"
import { MAINNET } from "../data/constants"
import Analytics from "./Analytics"
import Drawer from "./Drawer"
import ModalProvider from "./ModalProvider"
import NotificationProvider from "./NotificationProvider"
import PortalProvider from "./PortalProvider"
import Routes from "./Routes"

import type { PropsWithChildren } from "react"

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

  // autosign
  useInitializeAutoSign()

  return null
}

const queryClient = new QueryClient({ defaultOptions: { queries: { retry: 0 } } })

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
        <InjectWagmiConnector>
          <MemoryRouter>
            <PortalProvider>
              <Tooltip.Provider delayDuration={0} skipDelayDuration={0}>
                <NotificationProvider>
                  <ModalProvider>
                    {children}

                    <QueryClientProvider client={queryClient}>
                      <Analytics />
                      <AsyncBoundary
                        suspenseFallback={null}
                        errorBoundaryProps={{ fallback: null }}
                      >
                        <Prefetch />
                      </AsyncBoundary>

                      <Drawer>
                        <Routes />
                      </Drawer>
                    </QueryClientProvider>
                  </ModalProvider>
                </NotificationProvider>
              </Tooltip.Provider>
            </PortalProvider>
          </MemoryRouter>
        </InjectWagmiConnector>
      </ConfigContext.Provider>
    </>
  )
}

export default InterwovenKitProvider
