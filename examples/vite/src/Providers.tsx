import type { PropsWithChildren } from "react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { createConfig, http, WagmiProvider } from "wagmi"
import {
  InterwovenKitProvider,
  initiaPrivyWalletConnector,
  injectStyles,
  TESTNET,
} from "@initia/interwovenkit-react"
import css from "@initia/interwovenkit-react/styles.css?inline"
import { useTheme } from "./data"

injectStyles(css)
const minievm = {
  id: 4303131403034904,
  name: "Minievm",
  nativeCurrency: { name: "GAS", symbol: "GAS", decimals: 18 },
  rpcUrls: { default: { http: ["https://json-rpc.minievm-2.initia.xyz"] } },
}
const wagmiConfig = createConfig({
  connectors: [initiaPrivyWalletConnector],
  chains: [minievm],
  transports: { [minievm.id]: http() },
})
const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })

const Providers = ({ children }: PropsWithChildren) => {
  const theme = useTheme()
  return (
    <QueryClientProvider client={queryClient}>
      <WagmiProvider config={wagmiConfig}>
        <InterwovenKitProvider
          {...TESTNET}
          theme={theme}
          container={import.meta.env.DEV ? document.body : undefined}
          defaultChainId="minievm-2"
        >
          {children}
        </InterwovenKitProvider>
      </WagmiProvider>
    </QueryClientProvider>
  )
}

export default Providers
