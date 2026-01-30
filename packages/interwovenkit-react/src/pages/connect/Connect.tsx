import { descend } from "ramda"
import type { Connector } from "wagmi"
import { useConnect } from "wagmi"
import { useMemo, useState } from "react"
import { useReadLocalStorage } from "usehooks-ts"
import { useMutation } from "@tanstack/react-query"
import { normalizeError } from "@/data/http"
import { initiaPrivyWalletOptions } from "@/public/data/connectors"
import AllWallets from "./AllWallets"
import SignIn from "./SignIn"
import { useWalletConnectWallets } from "./useWalletConnectWallets"

export interface WalletInfo {
  id: string
  name: string
  image_url?: Partial<{ sm: string; md: string; lg: string }>
  homepage?: string
}

const Connect = ({ onSuccess }: { onSuccess?: () => void }) => {
  const { connectors, connectAsync } = useConnect()
  const recentConnectorId = useReadLocalStorage<string>("wagmi.recentConnectorId")
  const [pendingConnectorId, setPendingConnectorId] = useState<string | null>(null)
  const [view, setView] = useState<"signin" | "all">("signin")

  // Prefetch wallet list so it's ready when user clicks "More wallets"
  useWalletConnectWallets()

  const { mutate, isPending } = useMutation({
    mutationFn: async (connector: Connector) => {
      try {
        await connectAsync({ connector })
      } catch (error) {
        throw await normalizeError(error)
      }
    },
    onMutate: (connector: Connector) => {
      setPendingConnectorId(connector.id)
    },
    onSettled: () => {
      setPendingConnectorId(null)
    },
    onSuccess: () => {
      onSuccess?.()
    },
  })

  const sortedConnectors = useMemo(
    () => [...connectors].sort(descend((connector) => connector.id === recentConnectorId)),
    [connectors, recentConnectorId],
  )

  const privyConnector = useMemo(
    () => sortedConnectors.find((c) => c.id === initiaPrivyWalletOptions.id),
    [sortedConnectors],
  )
  const walletConnectors = useMemo(
    () => sortedConnectors.filter((c) => c.id !== initiaPrivyWalletOptions.id),
    [sortedConnectors],
  )

  if (view === "all") {
    return (
      <AllWallets
        walletConnectors={walletConnectors}
        isPending={isPending}
        pendingConnectorId={pendingConnectorId}
        recentConnectorId={recentConnectorId}
        onConnect={mutate}
        onBack={() => setView("signin")}
      />
    )
  }

  return (
    <SignIn
      walletConnectors={walletConnectors}
      privyConnector={privyConnector}
      isPending={isPending}
      pendingConnectorId={pendingConnectorId}
      onConnect={mutate}
      onShowAll={() => setView("all")}
    />
  )
}

export default Connect
