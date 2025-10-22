import {
  PrivyProvider,
  useCreateWallet,
  useCrossAppAccounts,
  usePrivy,
  useWallets,
} from "@privy-io/react-auth"
import { createConfig, WagmiProvider } from "wagmi"
import { http } from "wagmi"
import { mainnet } from "wagmi/chains"
import { type PropsWithChildren } from "react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import {
  INITIA_APP_ID,
  injectStyles,
  InterwovenKitProvider,
  TESTNET,
} from "@initia/interwovenkit-react"
import css from "@initia/interwovenkit-react/styles.css?inline"
import { isTestnet, routerApiUrl, useTheme } from "./data"

injectStyles(css)
const wagmiConfig = createConfig({
  multiInjectedProviderDiscovery: false,
  chains: [mainnet],
  transports: { [mainnet.id]: http() },
})
const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })

const InnerProviders = ({ children }: PropsWithChildren) => {
  const theme = useTheme()
  const privy = usePrivy()
  const crossAppAccounts = useCrossAppAccounts()
  const { createWallet } = useCreateWallet()
  const { wallets } = useWallets()

  return (
    <InterwovenKitProvider
      autoSignPermissions={{ "interwoven-1": ["/cosmos.bank.v1beta1.MsgSend"] }}
      privy={{ ...privy, crossAppAccounts, createWallet, wallets }}
      {...(isTestnet ? TESTNET : {})}
      {...(routerApiUrl ? { routerApiUrl } : {})}
      theme={theme}
      container={import.meta.env.DEV ? document.body : undefined}
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
          ethereum: {
            createOnLogin: "all-users",
          },
          showWalletUIs: false,
        },
        loginMethodsAndOrder: {
          primary: [`privy:${INITIA_APP_ID}`, "detected_ethereum_wallets"],
        },
      }}
    >
      <QueryClientProvider client={queryClient}>
        <WagmiProvider config={wagmiConfig}>
          <InnerProviders>{children}</InnerProviders>
        </WagmiProvider>
      </QueryClientProvider>
    </PrivyProvider>
  )
}

export default Providers
