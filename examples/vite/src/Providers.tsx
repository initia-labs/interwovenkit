import type { PropsWithChildren } from "react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { injectStyles, TESTNET } from "@initia/interwovenkit-react"
import { GhostWalletProvider } from "@initia/ghost-wallets-react"
import css from "@initia/interwovenkit-react/styles.css?inline"
import { isTestnet, routerApiUrl, useTheme } from "./data"

injectStyles(css)
const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })

const Providers = ({ children }: PropsWithChildren) => {
  const theme = useTheme()
  return (
    <QueryClientProvider client={queryClient}>
      <GhostWalletProvider
        privyAppId={import.meta.env.VITE_PRIVY_APP_ID || "clplo4596083njr0fi4eqh47y"}
        {...(isTestnet ? TESTNET : {})}
        {...(routerApiUrl ? { routerApiUrl } : {})}
        theme={theme}
        container={import.meta.env.DEV ? document.body : undefined}
        ghostWalletPermissions={{ "interwoven-1": ["/cosmos.bank.v1beta1.MsgSend"] }}
      >
        {children}
      </GhostWalletProvider>
    </QueryClientProvider>
  )
}

export default Providers
