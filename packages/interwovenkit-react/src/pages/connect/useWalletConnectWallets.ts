import { useQuery } from "@tanstack/react-query"
import type { WalletInfo } from "./Connect"

const WALLETCONNECT_PROJECT_ID = "5722e7dffb709492cf5312446ceeff73"
const WALLETCONNECT_API = `https://explorer-api.walletconnect.com/v3/wallets?projectId=${WALLETCONNECT_PROJECT_ID}`

export const walletConnectWalletsQueryKey = ["walletconnect-wallets"] as const

const isWalletInfoLike = (w: unknown): w is WalletInfo =>
  w !== null &&
  typeof w === "object" &&
  "id" in w &&
  typeof w.id === "string" &&
  "name" in w &&
  typeof w.name === "string"

export const fetchWalletConnectWallets = async (signal?: AbortSignal): Promise<WalletInfo[]> => {
  const response = await fetch(WALLETCONNECT_API, { signal })
  if (!response.ok) {
    throw new Error(`Failed to fetch wallets: ${response.status}`)
  }
  const data: unknown = await response.json()
  const listings =
    data !== null && typeof data === "object" && "listings" in data ? data.listings : data
  const raw = Object.values((listings as Record<string, unknown>) ?? {})
  return raw.filter(isWalletInfoLike)
}

export const useWalletConnectWallets = () => {
  return useQuery({
    queryKey: walletConnectWalletsQueryKey,
    queryFn: ({ signal }) => fetchWalletConnectWallets(signal),
    staleTime: 1000 * 60 * 60,
    retry: 2,
  })
}
