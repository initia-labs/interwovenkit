import { createConfig, http, WagmiProvider } from "wagmi"
import { mainnet } from "wagmi/chains"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import {
  initiaPrivyWalletConnector,
  injectStyles,
  InterwovenKitProvider,
  TESTNET,
} from "@initia/interwovenkit-react"
import css from "@initia/interwovenkit-react/styles.css?inline"
import { chainId, isTestnet, routerApiUrl, useTheme } from "./data"
import { testWalletConnector } from "./test-wallet"

import type { PropsWithChildren } from "react"

injectStyles(css)
const connectors = [
  initiaPrivyWalletConnector,
  ...(testWalletConnector ? [testWalletConnector] : []),
]
const wagmiConfig = createConfig({
  connectors,
  chains: [mainnet],
  transports: { [mainnet.id]: http() },
})
const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })

const InterwovenKitWrapper = ({ children }: PropsWithChildren) => {
  const theme = useTheme()

  return (
    <InterwovenKitProvider
      {...(isTestnet ? TESTNET : {})}
      {...(routerApiUrl ? { routerApiUrl } : {})}
      theme={theme}
      container={import.meta.env.DEV ? document.body : undefined}
      enableAutoSign={{ [chainId]: ["/cosmos.bank.v1beta1.MsgSend", "/initia.move.v1.MsgExecute"] }}
    >
      {children}
    </InterwovenKitProvider>
  )
}

const Providers = ({ children }: PropsWithChildren) => {
  return (
    <QueryClientProvider client={queryClient}>
      <WagmiProvider config={wagmiConfig}>
        <InterwovenKitWrapper>{children}</InterwovenKitWrapper>
      </WagmiProvider>
    </QueryClientProvider>
  )
}

export default Providers
