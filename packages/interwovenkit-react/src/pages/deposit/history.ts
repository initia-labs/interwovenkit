import { isIntegerString } from "./data/parse"
import type { DepositLastState, DepositSession } from "./wallet/depositSession"

export type DepositHistoryStatus =
  | "pending"
  | "problem"
  | "completed"
  | "failed"
  | "refunding"
  | "refunded"

const FAILED_STATES: DepositLastState[] = [
  "source_reverted",
  "source_cancelled",
  "bridge_failed",
  "failed",
]

const PROBLEM_STATES: DepositLastState[] = [
  "source_conflict",
  "bridge_partial",
  "bridge_refund_required",
  "below_minimum",
  "tracking_conflict",
  "unknown",
]

export function depositHistoryStatus(session: DepositSession): DepositHistoryStatus {
  if (session.lastState === "completed") return "completed"
  if (session.lastState === "bridge_refunding") return "refunding"
  if (session.lastState === "bridge_refunded") return "refunded"
  if (session.lastState && FAILED_STATES.includes(session.lastState)) return "failed"
  if (session.lastState && PROBLEM_STATES.includes(session.lastState)) return "problem"
  return "pending"
}

export function depositHistorySessions(sessions: DepositSession[]): DepositSession[] {
  const byId = new Map<string, DepositSession>()
  for (const session of sessions) {
    if (session.currentSourceHash && !byId.has(session.id)) byId.set(session.id, session)
  }
  return [...byId.values()]
}

const SOURCE_EXPLORERS: Record<string, { baseUrl: string; chainName: string }> = {
  "1": { baseUrl: "https://etherscan.io/tx/", chainName: "Ethereum" },
  "42161": { baseUrl: "https://arbiscan.io/tx/", chainName: "Arbitrum" },
  "8453": { baseUrl: "https://basescan.org/tx/", chainName: "Base" },
}

export function sourceExplorerUrl(chainId: string, txHash?: string): string | undefined {
  const explorer = SOURCE_EXPLORERS[chainId]
  return explorer && txHash && /^(?:0x)?[0-9a-f]{64}$/i.test(txHash)
    ? `${explorer.baseUrl}${txHash}`
    : undefined
}

export function savedDeliveryExplorerChainName(url: string, destinationChainName: string): string {
  const explorer = Object.values(SOURCE_EXPLORERS).find(({ baseUrl }) => url.startsWith(baseUrl))
  return explorer?.chainName ?? destinationChainName
}

export function matchesHistoryAccount(
  sender: string,
  recipient: string,
  addresses: Array<string | undefined>,
): boolean {
  const accounts = addresses.flatMap((address) => (address ? [address.toLowerCase()] : []))
  return [sender, recipient].some((address) => accounts.includes(address.toLowerCase()))
}

export function completedReceivedEvidence(
  bucket: string,
  amount: string | undefined,
  catalogDecimals: number | undefined,
  savedDecimals: number | undefined,
): DepositSession["received"] {
  const decimals = catalogDecimals ?? savedDecimals
  return bucket === "completed" && isIntegerString(amount) && decimals !== undefined
    ? { amount, decimals }
    : undefined
}
