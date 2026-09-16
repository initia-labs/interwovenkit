import { useQuery } from "@tanstack/react-query"
import { formatAmount } from "@initia/utils"
import Image from "@/components/Image"
import { formatDuration } from "@/pages/bridge/data/format"
import { useDepositApi } from "../data/api"
import { createBridgeOptionsQueryOptions, rankBridgeOptions } from "../data/bridges"
import type { BridgeOption } from "../data/types"
import DepositStatus from "../DepositStatus"
import DepositSubpage from "../DepositSubpage"
import { getBridgeToolDisplay } from "./depositSources"
import { formatNetworkFee, selectBridgeOption } from "./depositTransferLogic"
import { useTransferForm } from "./transferFlowConfig"
import { useDepositRequest, useDepositTransportResolution } from "./useDepositTransfer"
import styles from "./SelectDepositRoute.module.css"

const USDC_DECIMALS = 6

/** Amounts on this screen are all Ethereum USDC, the leg every route competes on. */
const formatUsdc = (amount: string) => `${formatAmount(amount, { decimals: USDC_DECIMALS })} USDC`

/**
 * Secondary line for an executable route: what it guarantees, how long it takes
 * and what it costs. Unknown values are dropped rather than rendered as zero — a
 * route with no duration estimate is not instant and one with no gas estimate is
 * not free.
 */
function describeRoute(option: BridgeOption): string {
  const duration = option.execution_duration_seconds
    ? formatDuration(option.execution_duration_seconds)
    : undefined
  const gas = option.gas_cost_usd ? formatNetworkFee(option.gas_cost_usd) : undefined
  return [`Min ${formatUsdc(option.min_received)}`, duration, gas]
    .filter((part): part is string => !!part)
    .join(" · ")
}

/**
 * The provider picker. It is a view over the options the form already fetched:
 * the request identity comes from the same `useDepositRequest`, so this query
 * resolves the identical cache entry and cannot rank against a different backend
 * state than the footer is gating on.
 *
 * Choosing an eligible route returns straight to the form — there is no separate
 * "use route" or review step, because the form plus its transaction details is
 * the review (see the plan's accepted selection-view revision).
 */
const SelectDepositRoute = () => {
  const { setValue, watch } = useTransferForm()
  const { selectedBridge: selectedBridgeKey = "" } = watch()
  const api = useDepositApi()
  const { resolution } = useDepositTransportResolution()
  const request = useDepositRequest(resolution)

  const isLifi = resolution.transport === "lifi"
  const { data, error, isLoading } = useQuery(
    createBridgeOptionsQueryOptions(api, request.identity, isLifi && request.isComplete),
  )

  const goBack = () => setValue("page", "fields")
  const ranked = rankBridgeOptions(data?.options ?? [])
  const { option: activeOption } = selectBridgeOption(ranked, selectedBridgeKey)
  const requiredMinimum = data ? formatUsdc(data.required_min_received) : ""

  const selectRoute = (option: BridgeOption) => {
    setValue("selectedBridge", option.bridge)
    setValue("page", "fields")
  }

  const renderBody = () => {
    if (!isLifi) return <DepositStatus>This deposit has no provider to choose</DepositStatus>
    if (error) return <DepositStatus error>{error.message}</DepositStatus>
    if (isLoading) return <DepositStatus>Finding routes...</DepositStatus>
    if (!ranked.length) return <DepositStatus>No routes available for this amount</DepositStatus>

    return (
      <DepositSubpage.List>
        {ranked.map((option) => {
          const { name, logoUrl } = getBridgeToolDisplay(option.bridge)
          return (
            <DepositSubpage.Row
              key={option.bridge}
              onClick={() => selectRoute(option)}
              isActive={option.bridge === activeOption?.bridge}
              disabled={!option.eligible}
              aria-label={name}
            >
              <Image src={logoUrl} alt={name} width={24} height={24} logo />
              <div className={styles.identity}>
                <p className={styles.name}>{name}</p>
                <p className={styles.meta}>
                  {option.eligible
                    ? describeRoute(option)
                    : `Below the ${requiredMinimum} Ethereum minimum`}
                </p>
              </div>
              <div className={styles.amount}>
                <p className={styles.out}>{formatUsdc(option.amount_out)}</p>
                <p className={styles.meta}>on Ethereum</p>
              </div>
            </DepositSubpage.Row>
          )
        })}
      </DepositSubpage.List>
    )
  }

  return (
    <DepositSubpage title="Select provider" onBack={goBack}>
      {renderBody()}
    </DepositSubpage>
  )
}

export default SelectDepositRoute
