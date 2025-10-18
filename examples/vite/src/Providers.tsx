import {
  PrivyProvider,
  useCreateWallet,
  useLogin,
  useLogout,
  useWallets,
} from "@privy-io/react-auth"
import { createConfig, WagmiProvider } from "@privy-io/wagmi"
import { http } from "wagmi"
import { mainnet } from "wagmi/chains"
import { type PropsWithChildren, useEffect } from "react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import {
  injectEip6369Wallet,
  injectStyles,
  InterwovenKitProvider,
  TESTNET,
} from "@initia/interwovenkit-react"
import css from "@initia/interwovenkit-react/styles.css?inline"
import { isTestnet, routerApiUrl, useTheme } from "./data"

injectStyles(css)
const wagmiConfig = createConfig({
  //connectors: [initiaPrivyWalletConnector],
  chains: [mainnet],
  transports: { [mainnet.id]: http() },
})
const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })

const InnerProviders = ({ children }: PropsWithChildren) => {
  const theme = useTheme()
  const { login } = useLogin()
  const { logout } = useLogout()
  const { createWallet } = useCreateWallet()
  const { wallets } = useWallets()

  useEffect(() => {
    return injectEip6369Wallet()
  }, [])

  return (
    <InterwovenKitProvider
      ghostWalletPermissions={{ "interwoven-1": ["/cosmos.bank.v1beta1.MsgSend"] }}
      privy={{ logout, login, createWallet, wallets }}
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
          theme: "light",
        },
        embeddedWallets: {
          ethereum: {
            createOnLogin: "all-users",
          },
          showWalletUIs: false,
        },
        loginMethodsAndOrder: {
          primary: ["detected_ethereum_wallets"],
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
