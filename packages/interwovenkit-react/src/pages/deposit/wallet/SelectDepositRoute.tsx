import BigNumber from "bignumber.js"
import clsx from "clsx"
import { useEffect } from "react"
import { useQueries, useQuery } from "@tanstack/react-query"
import { formatAmount } from "@initia/utils"
import Image from "@/components/Image"
import { USDC_DECIMALS } from "@/data/constants"
import { formatDuration } from "@/pages/bridge/data/format"
import { useDepositApi } from "../data/api"
import {
  createBridgeOptionsQueryOptions,
  percentDifference,
  rankBridgeOptions,
} from "../data/bridges"
import { createQuoteQueryOptions } from "../data/quote"
import { ETHEREUM_CHAIN_ID, ETHEREUM_USDC_DENOM, formatSourceMin } from "../data/source"
import type { BridgeOption, DestinationNetwork } from "../data/types"
import providerStyles from "../onramp/SelectProvider.module.css"
import DepositStatus from "../DepositStatus"
import DepositSubpage from "../DepositSubpage"
import { getBridgeToolDisplay } from "./depositSources"
import {
  combineEstimatedSeconds,
  formatNetworkFee,
  selectBridgeOption,
} from "./depositTransferLogic"
import { useTransferForm } from "./transferFlowConfig"
import { useDepositRequest, useDepositTransportResolution } from "./useDepositTransfer"
import styles from "./SelectDepositRoute.module.css"

/** Unknown cost or time is dropped rather than shown as free or instant. */
function describeRoute(option: BridgeOption, destination: DestinationNetwork | undefined): string {
  const gas = option.gas_cost_usd ? `Gas ${formatNetworkFee(option.gas_cost_usd)}` : undefined
  const seconds = combineEstimatedSeconds([
    option.execution_duration_seconds,
    destination?.processing_time_seconds,
  ])
  const duration = seconds ? formatDuration(seconds) : undefined
  return [gas, duration].filter((part): part is string => !!part).join(" · ")
}

const SelectDepositRoute = () => {
  const { setValue, watch } = useTransferForm()
  const selectedBridge = watch("selectedBridge")
  const api = useDepositApi()
  const { resolution } = useDepositTransportResolution()
  const request = useDepositRequest(resolution)

  const isLifi = resolution.transport === "lifi"
  const { data, error, isLoading } = useQuery(
    createBridgeOptionsQueryOptions(api, request.identity, isLifi && request.isComplete),
  )

  useEffect(() => {
    if (!isLifi) setValue("page", "fields")
  }, [isLifi, setValue])

  const ranked = rankBridgeOptions(data?.options ?? [])
  const { option: activeOption } = selectBridgeOption(ranked, selectedBridge)
  const best = ranked.find((option) => option.eligible)
  const requiredMinimum = data
    ? formatSourceMin(data.required_min_received, USDC_DECIMALS, "USDC")
    : ""

  // Final delivery per route, quoted from the USDC it lands on Ethereum.
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

  const renderList = () => {
    if (!isLifi) return null
    if (error) return <DepositStatus error>{error.message}</DepositStatus>
    if (isLoading) return <DepositStatus>Finding routes...</DepositStatus>
    if (!ranked.length) return <DepositStatus>No routes available for this amount</DepositStatus>

    return ranked.map((option) => {
      const { name, logoUrl } = getBridgeToolDisplay(option.bridge)
      const finalAmount = finalAmounts.get(option.amount_out)
      const difference =
        option.eligible && finalAmount !== bestFinal
          ? percentDifference(finalAmount, bestFinal)
          : ""
      return (
        <DepositSubpage.Row
          key={option.bridge}
          isActive={option.bridge === activeOption?.bridge}
          onClick={() => selectRoute(option)}
          disabled={!option.eligible}
        >
          <span className={providerStyles.left}>
            <Image src={logoUrl} width={28} height={28} logo />
            <span>
              <span className={providerStyles.name}>{name}</span>
              <span className={styles.meta}>
                {option.eligible
                  ? describeRoute(option, destination)
                  : `Below the ${requiredMinimum} minimum`}
              </span>
            </span>
            {option.bridge === best?.bridge && (
              <span className={clsx(providerStyles.badge, providerStyles["badge-success"])}>
                Best
              </span>
            )}
          </span>

          <span className={providerStyles.right}>
            <span className={providerStyles.amount}>
              {finalAmount && destination && route
                ? `${formatAmount(finalAmount, { decimals: destination.decimals })} ${route.dst_symbol}`
                : "—"}
            </span>
            {difference && <span className={providerStyles.diff}>{difference}</span>}
          </span>
        </DepositSubpage.Row>
      )
    })
  }

  return (
    <DepositSubpage title="Select route" onBack={() => setValue("page", "fields")}>
      <div className={providerStyles.header}>
        <span>Route</span>
        <span>You receive</span>
      </div>

      <DepositSubpage.List>{renderList()}</DepositSubpage.List>
    </DepositSubpage>
  )
}

export default SelectDepositRoute
