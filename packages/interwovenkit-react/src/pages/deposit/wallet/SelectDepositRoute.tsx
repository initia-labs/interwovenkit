import BigNumber from "bignumber.js"
import { useQueries, useQuery } from "@tanstack/react-query"
import { formatAmount } from "@initia/utils"
import Image from "@/components/Image"
import { useConfig } from "@/data/config"
import { UNKNOWN_VALUE, USDC_DECIMALS } from "@/data/constants"
import { formatDuration } from "@/pages/bridge/data/format"
import { useDepositApi } from "../data/api"
import {
  createBridgeOptionsQueryOptions,
  percentDifference,
  rankBridgeOptions,
} from "../data/bridges"
import { createQuoteQueryOptions } from "../data/quote"
import { formatSourceMin } from "../data/source"
import type { BridgeOption, DestinationNetwork } from "../data/types"
import DepositStatus from "../DepositStatus"
import DepositSubpage from "../DepositSubpage"
import { ETHEREUM_CHAIN_ID, ETHEREUM_USDC_DENOM, getBridgeToolDisplay } from "./depositSources"
import {
  combineEstimatedSeconds,
  formatNetworkFee,
  selectBridgeOption,
} from "./depositTransferLogic"
import { useTransferForm } from "./transferFlowConfig"
import { useDepositRequest, useDepositTransportResolution } from "./useDepositTransfer"
import styles from "./SelectDepositRoute.module.css"

/** Cost and total time on one line; unknown values are dropped rather than shown as free or instant. */
function describeRoute(option: BridgeOption, destination: DestinationNetwork | undefined): string {
  const gas = option.gas_cost_usd ? `Gas ${formatNetworkFee(option.gas_cost_usd)}` : undefined
  const seconds = combineEstimatedSeconds([
    option.execution_duration_seconds,
    destination?.processing_time_seconds,
  ])
  const duration = seconds ? formatDuration(seconds) : undefined
  return [gas, duration].filter((part): part is string => !!part).join(" · ")
}

// The request identity comes from the same `useDepositRequest` as the form, so
// this ranks the identical cache entry the footer is gating on.
const SelectDepositRoute = () => {
  const { setValue, watch } = useTransferForm()
  const { selectedBridge: selectedBridgeKey = "" } = watch()
  const { registryUrl } = useConfig()
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
  const best = ranked.find((option) => option.eligible)
  const requiredMinimum = data
    ? formatSourceMin(data.required_min_received, USDC_DECIMALS, "USDC")
    : ""

  // What each route finally delivers, quoted from the USDC it lands on Ethereum.
  // Keyed by amount, since routes quoting the same output share one entry.
  const destination = isLifi ? resolution.destination : undefined
  const route = isLifi ? resolution.route : undefined
  const amounts = [
    ...new Set(ranked.filter((option) => option.eligible).map((option) => option.amount_out)),
  ]
  const finalQuotes = useQueries({
    queries: amounts.map((amountIn) =>
      createQuoteQueryOptions(
        api,
        {
          srcChainId: ETHEREUM_CHAIN_ID,
          srcDenom: ETHEREUM_USDC_DENOM,
          dstChainId: destination?.chain_id ?? "",
          dstDenom: destination?.denom ?? "",
          amountIn,
        },
        !!destination,
      ),
    ),
  })
  const finalAmounts = new Map(
    amounts.map((amountIn, index) => {
      const { data, isPlaceholderData } = finalQuotes[index]
      const quoted = !isPlaceholderData && data?.status === "quoted"
      return [amountIn, quoted ? data.quote.amount_out : undefined]
    }),
  )
  const bestFinal = [...finalAmounts.values()]
    .filter((amount): amount is string => !!amount)
    .sort((a, b) => (BigNumber(a).gt(b) ? -1 : 1))[0]

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
          const finalAmount = finalAmounts.get(option.amount_out)
          const difference = option.eligible ? percentDifference(finalAmount, bestFinal) : ""
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
                <p className={styles.name}>
                  {name}
                  {option.bridge === best?.bridge && <span className={styles.best}>Best</span>}
                </p>
                <p className={styles.meta}>
                  {option.eligible
                    ? describeRoute(option, destination)
                    : `Below the ${requiredMinimum} minimum`}
                </p>
              </div>
              <div className={styles.amount}>
                <p className={styles.out}>
                  <Image
                    src={`${registryUrl}/images/${route?.dst_symbol}.png`}
                    alt={route?.dst_symbol}
                    width={14}
                    height={14}
                    logo
                  />
                  {finalAmount && destination
                    ? formatAmount(finalAmount, { decimals: destination.decimals })
                    : UNKNOWN_VALUE}
                </p>
                {difference && <p className={styles.meta}>{difference}</p>}
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
