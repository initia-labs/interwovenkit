import type { EIP1193Provider } from "viem"
import { mainnet } from "viem/chains"
import { http, useConfig as useWagmiConfig, useReconnect } from "wagmi"
import { injected } from "wagmi/connectors"
import { type PropsWithChildren, useEffect, useState } from "react"
import { useConfig } from "@/data/config.js"
import { initiaPrivyWalletOptions } from "@/public/data/connectors.js"
import { usePrivyProvider } from "./usePrivyProvider.js"

const WagmiInjector = (props: PropsWithChildren) => {
  const { children } = props

  const config = useWagmiConfig()
  const { reconnect } = useReconnect()
  const { provider, ready, meta } = usePrivyProvider({ chain: mainnet, transport: http() })
  const [isSetup, setIsSetup] = useState(false)

  useEffect(() => {
    const id = meta?.id || initiaPrivyWalletOptions.id
    const setup = async (provider: EIP1193Provider) => {
      config.storage?.removeItem(`${id}.disconnected`)
      const wagmiConnector = injected({
        target: {
          provider,
          id,
          name: meta?.name || initiaPrivyWalletOptions.name,
          icon: meta?.icon || initiaPrivyWalletOptions.iconUrl,
        },
      })

      const connector = config._internal.connectors.setup(wagmiConnector)
      await config.storage?.setItem("recentConnectorId", id)
      config._internal.connectors.setState([connector])

      return connector
    }

    if (ready && (!isSetup || config.connectors.length === 0)) {
      setup(provider).then((connector) => {
        if (connector) {
          reconnect({ connectors: [connector] })
          setIsSetup(true)
        }
      })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [provider, ready, isSetup, config, reconnect])

  return <>{children}</>
}

export const InjectWagmiConnector = (props: PropsWithChildren) => {
  const { privy } = useConfig()
  if (!privy) {
    return <>{props.children}</>
  }
  return <WagmiInjector {...props} />
}
