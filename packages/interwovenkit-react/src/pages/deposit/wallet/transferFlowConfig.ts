import { createContext, useContext } from "react"
import { useFormContext } from "react-hook-form"
import type { BridgeTxResult } from "@/pages/bridge/data/tx"

export type TransferPage = "select-local" | "select-external" | "fields" | "completed"

export interface TransferFormValues {
  page: TransferPage
  quantity: string
  srcDenom: string
  srcChainId: string
  dstDenom: string
  dstChainId: string
  // TX completion data
  result?: BridgeTxResult
}

export type TransferMode = "deposit" | "withdraw"

// Union of consistent src/dst pairs so a mismatched combination
// ({ denomKey: "srcDenom", chainIdKey: "dstChainId" }) cannot typecheck.
type TransferAssetKeys =
  | { denomKey: "srcDenom"; chainIdKey: "srcChainId" }
  | { denomKey: "dstDenom"; chainIdKey: "dstChainId" }

interface TransferModeConfig {
  mode: TransferMode
  label: "Deposit" | "Withdraw"
  local: TransferAssetKeys
  external: TransferAssetKeys
}

const TRANSFER_MODE_CONFIG: Record<TransferMode, TransferModeConfig> = {
  deposit: {
    mode: "deposit",
    label: "Deposit",
    local: { denomKey: "dstDenom", chainIdKey: "dstChainId" },
    external: { denomKey: "srcDenom", chainIdKey: "srcChainId" },
  },
  withdraw: {
    mode: "withdraw",
    label: "Withdraw",
    local: { denomKey: "srcDenom", chainIdKey: "srcChainId" },
    external: { denomKey: "dstDenom", chainIdKey: "dstChainId" },
  },
}

export function getTransferModeConfig(mode: TransferMode): TransferModeConfig {
  return TRANSFER_MODE_CONFIG[mode]
}

/**
 * Flow-wide config provided by TransferFlow: `mode` is fixed for the flow's
 * lifetime and `onExit` is set when the flow is embedded in the deposit hub.
 * Context instead of props — every page of the flow reads it, and passing it
 * through TransferFlowRoutes and each hook argument only added repetition.
 */
export interface TransferFlowConfig {
  mode: TransferMode
  onExit?: () => void
}

export const TransferFlowContext = createContext<TransferFlowConfig | null>(null)

export function useTransferFlow(): TransferFlowConfig {
  const config = useContext(TransferFlowContext)
  if (!config) throw new Error("useTransferFlow must be used within TransferFlow")
  return config
}

export function useTransferMode() {
  const { mode } = useTransferFlow()
  return getTransferModeConfig(mode)
}

export function useTransferForm() {
  return useFormContext<TransferFormValues>()
}
