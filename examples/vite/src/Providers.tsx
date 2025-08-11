import type { PropsWithChildren } from "react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { createConfig, http, WagmiProvider } from "wagmi"
import { mainnet } from "wagmi/chains"
import {
  InterwovenKitProvider,
  initiaPrivyWalletConnector,
  injectStyles,
  TESTNET,
} from "@initia/interwovenkit-react"
import css from "@initia/interwovenkit-react/styles.css?inline"
import { isTestnet, useTheme } from "./data"

// Inertia
import type { Chain } from "@initia/initia-registry-types"
import customChain from "./inertia/chain.json"
import { aminoConverters, inertiaRegistryTypes } from "./inertia/message"

injectStyles(css)
const wagmiConfig = createConfig({
  connectors: [initiaPrivyWalletConnector],
  chains: [mainnet],
  transports: { [mainnet.id]: http() },
})
const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })

const Providers = ({ children }: PropsWithChildren) => {
  const theme = useTheme()
  return (
    <QueryClientProvider client={queryClient}>
      <WagmiProvider config={wagmiConfig}>
        <InterwovenKitProvider
          {...(isTestnet ? TESTNET : {})}
          theme={theme}
          container={import.meta.env.DEV ? document.body : undefined}
          defaultChainId="inertiation-12"
          customChain={customChain as Chain}
          protoTypes={inertiaRegistryTypes}
          aminoConverters={aminoConverters}
        >
          {children}
        </InterwovenKitProvider>
      </WagmiProvider>
    </QueryClientProvider>
  )
}

export default Providers
