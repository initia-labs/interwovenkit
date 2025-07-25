import { head, zipObj } from "ramda"
import { capitalCase } from "change-case"
import { useToggle } from "usehooks-ts"
import { Collapsible } from "radix-ui"
import { useAccount } from "wagmi"
import type { OperationJson, SwapVenueJson } from "@skip-go/client"
import { IconList, IconMinus, IconWallet } from "@initia/icons-react"
import { AddressUtils } from "@/public/utils"
import AsyncBoundary from "@/components/AsyncBoundary"
import Image from "@/components/Image"
import FlexEnd from "@/components/FlexEnd"
import { useBridgePreviewState } from "./data/tx"
import { useCosmosWallets } from "./data/cosmos"
import OperationItem from "./OperationItem"
import styles from "./BridgePreviewRoute.module.css"

function normalizeOperation(operation: OperationJson) {
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

interface Props {
  addressList: string[]
}

const BridgePreviewRoute = ({ addressList }: Props) => {
  const { values, route } = useBridgePreviewState()
  const { source_asset_denom, source_asset_chain_id, amount_in, operations } = route
  const addressMap = zipObj(route.required_chain_addresses, addressList)

  const { find } = useCosmosWallets()
  const { connector, address: connectedAddress = "" } = useAccount()

  const [showAll, toggleShowAll] = useToggle(false)
  const canToggleShowAll = operations.length > 1

  const connectedWalletIcon = (
    <Image
      src={values.cosmosWalletName ? find(values.cosmosWalletName)?.image : connector?.icon}
      width={12}
      height={12}
    />
  )

  const firstOperationProps = {
    amount: amount_in,
    denom: source_asset_denom,
    chainId: source_asset_chain_id,
    address: values.sender,
    walletIcon: connectedWalletIcon,
  }

  const getWalletIcon = (address: string) => {
    if (AddressUtils.equals(address, connectedAddress)) return connectedWalletIcon
    return <IconWallet size={11} />
  }

  const toProps = (normalizedOperation: ReturnType<typeof normalizeOperation>) => {
    // prettier-ignore
    // @ts-expect-error Skip API's response structure is too complicated
    const { label, amount_out, denom, denom_out = denom, chain_id, from_chain_id, to_chain_id = chain_id ?? from_chain_id } = normalizedOperation
    const address = addressMap[to_chain_id]
    return {
      label: canToggleShowAll && !showAll ? undefined : label,
      amount: amount_out,
      denom: denom_out,
      chainId: to_chain_id,
      address,
      walletIcon: getWalletIcon(address),
    }
  }

  const operationProps = operations.map(normalizeOperation).map(toProps)
  const intermediateOperations = operationProps.slice(0, -1)
  const lastOperationProps = operationProps[operationProps.length - 1]

  return (
    <Collapsible.Root className={styles.root} open={showAll} onOpenChange={toggleShowAll}>
      {canToggleShowAll && (
        <Collapsible.Trigger asChild>
          <FlexEnd>
            <button className={styles.toggle} onClick={toggleShowAll}>
              {showAll ? (
                <>
                  <IconMinus size={12} />
                  <span>Hide details</span>
                </>
              ) : (
                <>
                  <IconList size={12} />
                  <span>Show details</span>
                </>
              )}
            </button>
          </FlexEnd>
        </Collapsible.Trigger>
      )}

      <div className={styles.route}>
        <OperationItem {...firstOperationProps} source />

        <Collapsible.Content className={styles.content}>
          {intermediateOperations.map((props, index) => (
            <AsyncBoundary
              suspenseFallback={<OperationItem.Placeholder {...props} />}
              errorBoundaryProps={{ fallback: <OperationItem.Placeholder {...props} /> }}
              key={index}
            >
              <OperationItem {...props} />
            </AsyncBoundary>
          ))}
        </Collapsible.Content>

        <OperationItem {...lastOperationProps} />
      </div>
    </Collapsible.Root>
  )
}

export default BridgePreviewRoute
