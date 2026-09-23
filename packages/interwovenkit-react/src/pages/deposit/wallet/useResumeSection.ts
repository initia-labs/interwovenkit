import { useMemo } from "react"
import { IconWallet } from "@initia/icons-react"
import { formatAmount } from "@initia/utils"
import { useConfig } from "@/data/config"
import { useLocationState } from "@/lib/router"
import { useInitiaAddress } from "@/public/data/hooks"
import type { DepositLocationState } from "../data/assetOptions"
import { useDepositForm } from "../context"
import type { DepositMethodSection } from "../DepositMethodList"
import { resumeStageLabel, selectResumableSessions } from "./depositProgressLogic"
import { type DepositSession, useDepositSessionStore } from "./depositSession"
import { resolveDepositRecipient } from "./depositTransferLogic"

export type ResumeSelection = `resume:${string}`

export function useResumeSection(): DepositMethodSection<ResumeSelection> | undefined {
  const { depositApiUrl, registryUrl } = useConfig()
  const store = useDepositSessionStore()
  const storedSessions = useMemo(
    () => (depositApiUrl ? store.list(depositApiUrl) : []),
    [store, depositApiUrl],
  )
  const initiaAddress = useInitiaAddress()
  const { watch } = useDepositForm()
  const { remoteOptions = [], recipientAddress } = useLocationState<DepositLocationState>()

  if (!depositApiUrl || !initiaAddress) return undefined
  // Only offer sessions this request could have created.
  const resolved = resolveDepositRecipient(recipientAddress, initiaAddress)
  if (!("recipient" in resolved)) return undefined
  const sessions = selectResumableSessions(storedSessions, {
    recipient: resolved.recipient,
    dstChainId: watch("receiveChainId"),
    dstDenom: watch("receiveDenom"),
    remoteOptions,
  })
  if (sessions.length === 0) return undefined

  return {
    label: "Continue deposit",
    methods: sessions.map((session) => ({
      id: `resume:${session.id}` as const,
      title: resumeRowTitle(session),
      subtext: resumeStageLabel(session),
      Icon: IconWallet,
      iconUrl: `${registryUrl}/images/${session.source.symbol}.png`,
      chainIconUrl: session.source.chainLogoUrl,
    })),
  }
}

function resumeRowTitle(session: DepositSession): string {
  const { amount, decimals, symbol, chainName } = session.source
  return `${formatAmount(amount, { decimals })} ${symbol} from ${chainName}`
}
