import { type ReactNode } from "react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { PrivyProvider, usePrivy } from "@privy-io/react-auth"
import { WagmiProvider, createConfig } from "@privy-io/wagmi"
import { InterwovenKitProvider } from "@initia/interwovenkit-react"
import type { Config } from "@initia/interwovenkit-react"
import { http } from "viem"
import { mainnet } from "viem/chains"
import { GhostWalletContext } from "./hooks"

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 0,
      refetchOnWindowFocus: false,
    },
  },
})

const wagmiConfig = createConfig({
  chains: [mainnet],
  transports: {
    [mainnet.id]: http(),
  },
})

export interface GhostWalletProviderProps extends Partial<Omit<Config, "disconnectAction">> {
  privyAppId: string
  ghostWalletPermissions: Record<string, string[]>
  children: ReactNode
}

function GhostWalletInnerProvider({
  children,
  ...interwovenKitConfig
}: {
  children: ReactNode
} & Partial<Omit<Config, "disconnectAction">>) {
  const { logout } = usePrivy()

  return (
    <InterwovenKitProvider {...interwovenKitConfig} disconnectAction={logout}>
      {children}
    </InterwovenKitProvider>
  )
}

export function GhostWalletProvider({
  privyAppId,
  ghostWalletPermissions,
  children,
  ...interwovenKitConfig
}: GhostWalletProviderProps) {
  return (
    <QueryClientProvider client={queryClient}>
      <GhostWalletContext.Provider value={{ permissions: ghostWalletPermissions }}>
        <PrivyProvider
          appId={privyAppId}
          config={{
            appearance: {
              theme: "light",
            },
            embeddedWallets: {
              ethereum: {
                createOnLogin: "all-users",
              },
              showWalletUIs: false,
            },
            loginMethodsAndOrder: {
              primary: ["detected_ethereum_wallets", "privy:cmbq1ozyc006al70lx4uciz0q"],
            },
          }}
        >
          <WagmiProvider config={wagmiConfig}>
            <GhostWalletInnerProvider {...interwovenKitConfig}>{children}</GhostWalletInnerProvider>
          </WagmiProvider>
        </PrivyProvider>
      </GhostWalletContext.Provider>
    </QueryClientProvider>
  )
}
