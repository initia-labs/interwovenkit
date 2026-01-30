import { descend } from "ramda"
import type { Connector } from "wagmi"
import { useConnect } from "wagmi"
import { useState } from "react"
import { useReadLocalStorage } from "usehooks-ts"
import { useMutation } from "@tanstack/react-query"
import { normalizeError } from "@/data/http"
import { initiaPrivyWalletOptions } from "@/public/data/connectors"
import AllWallets from "./AllWallets"
import SignIn from "./SignIn"

export interface WalletInfo {
  id: string
  name: string
  image_url: { sm: string; md: string; lg: string }
  homepage?: string
  rdns?: string | null
}

const Connect = ({ onSuccess }: { onSuccess?: () => void }) => {
  const { connectors, connectAsync } = useConnect()
  const recentConnectorId = useReadLocalStorage<string>("wagmi.recentConnectorId")
  const [pendingConnectorId, setPendingConnectorId] = useState<string | null>(null)
  const [view, setView] = useState<"signin" | "all">("signin")

  const { mutate, isPending } = useMutation({
    mutationFn: async (connector: Connector) => {
      setPendingConnectorId(connector.id)
      try {
        await connectAsync({ connector })
      } catch (error) {
        throw await normalizeError(error)
      }
    },
    onSettled: () => {
      setPendingConnectorId(null)
    },
    onSuccess: () => {
      onSuccess?.()
    },
  })

  const sortedConnectors = connectors.toSorted(
    descend((connector) => connector.id === recentConnectorId),
  )

  const privyConnector = sortedConnectors.find((c) => c.id === initiaPrivyWalletOptions.id)
  const walletConnectors = sortedConnectors.filter((c) => c.id !== initiaPrivyWalletOptions.id)

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
