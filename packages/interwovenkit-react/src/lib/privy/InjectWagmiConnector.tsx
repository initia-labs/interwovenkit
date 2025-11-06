// https://github.com/Abstract-Foundation/agw-sdk/blob/main/packages/agw-react/src/privy/injectWagmiConnector.tsx

import type { EIP1193Provider } from "viem"
import { http, useConfig, useReconnect } from "wagmi"
import { injected } from "wagmi/connectors"
import { type PropsWithChildren, useEffect, useState } from "react"
import { initiaPrivyWalletOptions } from "@/public/data/connectors"
import { usePrivyCrossAppProvider } from "./usePrivyCrossAppProvider"

const InjectWagmiConnector = (props: PropsWithChildren) => {
  const { children } = props

  const config = useConfig()
  const { reconnect } = useReconnect()
  const { provider, ready, meta } = usePrivyCrossAppProvider({
    chain: config.chains[0],
    transport: http(),
  })
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
  }, [provider, ready, isSetup, config, reconnect, meta])

  return children
}

export default InjectWagmiConnector
