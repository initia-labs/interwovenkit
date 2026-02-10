import type { Connector } from "wagmi"
import { useConnect } from "wagmi"
import { useMemo, useState } from "react"
import { useReadLocalStorage } from "usehooks-ts"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { normalizeError, STALE_TIMES } from "@/data/http"
import { initiaPrivyWalletOptions } from "@/public/data/connectors"
import AllWallets from "./AllWallets"
import SignIn from "./SignIn"
import { fetchWalletConnectWallets, walletConnectWalletsQueryKey } from "./useWalletConnectWallets"

const Connect = ({ onSuccess }: { onSuccess?: () => void }) => {
  const { connectors, connectAsync } = useConnect()
  const recentConnectorId = useReadLocalStorage<string>("wagmi.recentConnectorId")
  const [pendingConnectorId, setPendingConnectorId] = useState<string | null>(null)
  const [view, setView] = useState<"signin" | "all">("signin")
  const queryClient = useQueryClient()
  const prefetchWalletConnectWallets = () =>
    queryClient.prefetchQuery({
      queryKey: walletConnectWalletsQueryKey,
      queryFn: ({ signal }) => fetchWalletConnectWallets(signal),
      staleTime: STALE_TIMES.INFINITY,
      gcTime: STALE_TIMES.INFINITY,
    })

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
    () =>
      [...connectors].sort((a, b) => {
        if (a.id === recentConnectorId) return -1
        if (b.id === recentConnectorId) return 1
        return a.name.localeCompare(b.name)
      }),
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
      recentConnectorId={recentConnectorId}
      onConnect={mutate}
      onShowAll={() => setView("all")}
      onPrefetchWallets={prefetchWalletConnectWallets}
    />
  )
}

export default Connect
