import type { PropsWithChildren } from "react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { PrivyProvider } from "@privy-io/react-auth"
import { createConfig, WagmiProvider } from "@privy-io/wagmi"
import { http } from "wagmi"
import { mainnet } from "wagmi/chains"
import {
  InterwovenKitProvider,
  initiaPrivyWalletConnector,
  injectStyles,
  TESTNET,
} from "@initia/interwovenkit-react"
import css from "@initia/interwovenkit-react/styles.css?inline"
import { isTestnet, routerApiUrl, useTheme } from "./data"

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
    <PrivyProvider
      appId="cmbqs2wzv007qky0m8kxyqn7r"
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
      <QueryClientProvider client={queryClient}>
        <WagmiProvider config={wagmiConfig}>
          <InterwovenKitProvider
            ghostWalletPermissions={["/cosmos.bank.v1beta1.MsgSend"]}
            {...(isTestnet ? TESTNET : {})}
            {...(routerApiUrl ? { routerApiUrl } : {})}
            theme={theme}
            container={import.meta.env.DEV ? document.body : undefined}
          >
            {children}
          </InterwovenKitProvider>
        </WagmiProvider>
      </QueryClientProvider>
    </PrivyProvider>
  )
}

export default Providers
