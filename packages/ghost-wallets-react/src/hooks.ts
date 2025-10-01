import { createContext, useContext } from "react"
import { InitiaAddress } from "@initia/utils"
import { usePrivy, useWallets } from "@privy-io/react-auth"
import { useDrawerControl } from "@initia/interwovenkit-react"
import { GhostWalletPage } from "./components/GhostWalletPage"
import { useIsGhostWalletEnabled } from "./data/state"

// Ghost Wallet Context
interface GhostWalletContextValue {
  permissions: Record<string, string[]>
}

export const GhostWalletContext = createContext<GhostWalletContextValue>({ permissions: {} })

export function useGhostWalletPermissions() {
  const context = useContext(GhostWalletContext)
  return context.permissions
}

export function useEmbeddedWallet() {
  const { wallets } = useWallets()
  return wallets.find((w) => w.connectorType === "embedded")
}

export function useEmbeddedWalletAddress() {
  const embeddedWallet = useEmbeddedWallet()
  return embeddedWallet?.address ? InitiaAddress(embeddedWallet.address).bech32 : undefined
}

/* public */
export function useGhostWallet() {
  const { openDrawer } = useDrawerControl()
  const { login, authenticated } = usePrivy()
  const enabledGhostWallets = useIsGhostWalletEnabled()

  return {
    openConnect: login,
    requestGhostWallet: (chainId: string) => {
      if (!authenticated) throw new Error("User must be authenticated to request a ghost wallet")
      if (enabledGhostWallets[chainId])
        throw new Error("Ghost wallet is already enabled for the requested chainId")

      openDrawer(() => GhostWalletPage({ chainId }))
    },
    enabledGhostWallets,
  }
}
