import type { OperationJson, SwapVenueJson } from "@skip-go/client"
import { capitalCase } from "change-case"
import { head } from "ramda"

// The router returns `cctp_transfer_v2`, but `@skip-go/client` does not type it.
interface CCTPTransferV2OperationJson {
  cctp_transfer_v2: {
    from_chain_id: string
    to_chain_id: string
    denom_in: string
    denom_out: string
  }
  tx_index: number
  amount_in: string
  amount_out: string
}

export function normalizeOperation(operation: OperationJson | CCTPTransferV2OperationJson) {
  const getVenueName = ({ name }: SwapVenueJson) => {
    if (name === "initia-dex") return "Initia DEX"
    return capitalCase(head(name?.split("-") ?? []) ?? "")
  }

  if ("transfer" in operation) {
    return { label: "Bridge via IBC", ...operation, ...operation.transfer }
  }
  if ("bank_send" in operation) {
    return { label: "Send", ...operation, ...operation.bank_send }
  }
  if ("swap" in operation) {
    const venue = operation.swap?.swap_venues?.map(getVenueName).join(", ")
    return { label: venue ? `Swap on ${venue}` : "Swap", ...operation, ...operation.swap }
  }
  if ("axelar_transfer" in operation) {
    return { label: "Bridge via Axelar", ...operation, ...operation.axelar_transfer }
  }
  if ("cctp_transfer" in operation) {
    return { label: "Bridge via CCTP", ...operation, ...operation.cctp_transfer }
  }
  if ("cctp_transfer_v2" in operation) {
    return { label: "Bridge via CCTP", ...operation, ...operation.cctp_transfer_v2 }
  }
  if ("hyperlane_transfer" in operation) {
    return { label: "Bridge via Hyperlane", ...operation, ...operation.hyperlane_transfer }
  }
  if ("evm_swap" in operation) {
    const venue = operation.evm_swap?.swap_venues?.map(getVenueName).join(", ")
    return { label: venue ? `Swap on ${venue}` : "Swap", ...operation, ...operation.evm_swap }
  }
  if ("op_init_transfer" in operation) {
    return { label: "Bridge via OP Bridge", ...operation, ...operation.op_init_transfer }
  }
  if ("go_fast_transfer" in operation) {
    return { label: "Bridge via Go Fast", ...operation, ...operation.go_fast_transfer }
  }
  if ("eureka_transfer" in operation) {
    return { label: "Bridge via Eureka", ...operation, ...operation.eureka_transfer }
  }
  if ("stargate_transfer" in operation) {
    return { label: "Bridge via Stargate", ...operation, ...operation.stargate_transfer }
  }
  if ("layer_zero_transfer" in operation) {
    return { label: "Bridge via LayerZero", ...operation, ...operation.layer_zero_transfer }
  }
  throw new Error("Unknown operation type")
}
