import {
  PrivyProvider,
  useCreateWallet,
  useLoginWithSiwe,
  usePrivy,
  useWallets,
} from "@privy-io/react-auth"
import { createConfig, http, WagmiProvider } from "wagmi"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import {
  initiaPrivyWalletConnector,
  injectStyles,
  InterwovenKitProvider,
  PRIVY_APP_ID,
  TESTNET,
} from "@initia/interwovenkit-react"
import css from "@initia/interwovenkit-react/styles.css?inline"
import { chainId, routerApiUrl, useTheme } from "./data"

import type { PropsWithChildren } from "react"

injectStyles(css)
const minievm = {
  id: 2124225178762456,
  name: "Evm",
  nativeCurrency: { name: "INIT", symbol: "INIT", decimals: 18 },
  rpcUrls: { default: { http: ["https://jsonrpc-evm-1.anvil.asia-southeast.initia.xyz"] } },
}
const wagmiConfig = createConfig({
  connectors: [initiaPrivyWalletConnector],
  chains: [minievm],
  transports: { [minievm.id]: http() },
})
const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })

const InterwovenKitWrapper = ({ children }: PropsWithChildren) => {
  const theme = useTheme()
  const privy = usePrivy()
  const siwe = useLoginWithSiwe()
  const { wallets } = useWallets()
  const { createWallet } = useCreateWallet()

  return (
    <InterwovenKitProvider
      {...TESTNET}
      {...(routerApiUrl ? { routerApiUrl } : {})}
      theme={theme}
      container={import.meta.env.DEV ? document.body : undefined}
      privyContext={{ privy, siwe, wallets, createWallet }}
      enableAutoSign={{ [chainId]: ["/cosmos.bank.v1beta1.MsgSend"] }}
    >
      {children}
    </InterwovenKitProvider>
  )
}

const Providers = ({ children }: PropsWithChildren) => {
  return (
    <PrivyProvider
      appId="cmbqs2wzv007qky0m8kxyqn7r"
      config={{
        appearance: {
          theme: "dark",
        },
        embeddedWallets: {
          ethereum: { createOnLogin: "all-users" },
          showWalletUIs: false,
        },
        loginMethodsAndOrder: {
          primary: [`privy:${PRIVY_APP_ID}`, "detected_ethereum_wallets"],
        },
      }}
    >
      <QueryClientProvider client={queryClient}>
        <WagmiProvider config={wagmiConfig}>
          <InterwovenKitWrapper>{children}</InterwovenKitWrapper>
        </WagmiProvider>
      </QueryClientProvider>
    </PrivyProvider>
  )
}

export default Providers
