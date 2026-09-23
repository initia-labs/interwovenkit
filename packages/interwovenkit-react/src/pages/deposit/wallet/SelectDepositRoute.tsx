import clsx from "clsx"
import { useEffect } from "react"
import { useQuery } from "@tanstack/react-query"
import { formatAmount } from "@initia/utils"
import Image from "@/components/Image"
import { formatDuration } from "@/pages/bridge/data/format"
import { useDepositApi } from "../data/api"
import {
  createBridgeOptionsQueryOptions,
  percentDifference,
  rankBridgeOptions,
} from "../data/bridges"
import { userErrorMessage } from "../data/parse"
import { formatSourceMin } from "../data/source"
import type { BridgeOption, DestinationNetwork } from "../data/types"
import providerStyles from "../onramp/SelectProvider.module.css"
import DepositStatus from "../DepositStatus"
import DepositSubpage from "../DepositSubpage"
import { getBridgeToolDisplay } from "./depositSources"
import {
  combineEstimatedSeconds,
  deliverySeconds,
  formatNetworkFee,
  selectBridgeOption,
} from "./depositTransferLogic"
import { useTransferForm } from "./transferFlowConfig"
import {
  useDeliveryQuote,
  useDepositRequest,
  useDepositTransportResolution,
} from "./useDepositTransfer"
import styles from "./SelectDepositRoute.module.css"

const OPTIONS_REFRESH_MS = 20_000

/** Unknown cost or time is dropped rather than shown as free or instant. */
function describeRoute(option: BridgeOption, delivery: number | null | undefined): string {
  const gas = option.gas_cost_usd ? `Gas ${formatNetworkFee(option.gas_cost_usd)}` : undefined
  const seconds = combineEstimatedSeconds([option.execution_duration_seconds, delivery])
  const duration = seconds ? formatDuration(seconds) : undefined
  return [gas, duration].filter((part): part is string => !!part).join(" · ")
}

// Not polled: the options refresh re-keys every row whose amount moved.
function useFinalQuote(amountIn: string, destination: DestinationNetwork | undefined) {
  const { data } = useDeliveryQuote(destination, amountIn, false)
  return amountIn && data?.status === "quoted" ? data.quote : undefined
}

interface RouteRowProps {
  option: BridgeOption
  destination: DestinationNetwork
  symbol: string
  isActive: boolean
  isBest: boolean
  bestFinal?: string
  requiredMinimum: string
  onSelect: () => void
}

const RouteRow = (props: RouteRowProps) => {
  const { option, destination, symbol, isActive, isBest, bestFinal, requiredMinimum } = props
  const { name, logoUrl } = getBridgeToolDisplay(option.bridge)
  const finalQuote = useFinalQuote(option.eligible ? option.amount_out : "", destination)
  const finalAmount = finalQuote?.amount_out
  const difference = option.eligible && !isBest ? percentDifference(finalAmount, bestFinal) : ""

  return (
    <DepositSubpage.Row isActive={isActive} onClick={props.onSelect} disabled={!option.eligible}>
      <span className={providerStyles.left}>
        <Image src={logoUrl} width={28} height={28} logo />
        <span className={styles.text}>
          <span className={providerStyles.left}>
            <span className={clsx(providerStyles.name, styles.name)}>{name}</span>
            {isBest && (
              <span className={clsx(providerStyles.badge, providerStyles["badge-success"])}>
                Best
              </span>
            )}
          </span>
          <span className={styles.meta}>
            {option.eligible
              ? describeRoute(option, deliverySeconds(finalQuote, destination))
              : `Below the ${requiredMinimum} minimum`}
          </span>
        </span>
      </span>

      <span className={providerStyles.right}>
        <span className={providerStyles.amount}>
          {finalAmount
            ? `${formatAmount(finalAmount, { decimals: destination.decimals })} ${symbol}`
            : "—"}
        </span>
        {difference && (
          <span className={clsx(providerStyles.diff, difference.startsWith("+") && styles.gain)}>
            {difference}
          </span>
        )}
      </span>
    </DepositSubpage.Row>
  )
}

const SelectDepositRoute = () => {
  const { setValue, watch } = useTransferForm()
  const selectedBridge = watch("selectedBridge")
  const api = useDepositApi()
  const { resolution } = useDepositTransportResolution()
  const request = useDepositRequest(resolution)

  const isLifi = resolution.transport === "lifi"
  const { data, error, isLoading, isPlaceholderData } = useQuery({
    ...createBridgeOptionsQueryOptions(api, request.identity, isLifi && request.isComplete),
    refetchInterval: OPTIONS_REFRESH_MS,
  })

  useEffect(() => {
    if (!isLifi) setValue("page", "fields")
  }, [isLifi, setValue])

  const ranked = rankBridgeOptions(data?.options ?? [])
  const { option: activeOption } = selectBridgeOption(ranked, selectedBridge)
  const best = ranked.find((option) => option.eligible)
  const bestFinal = useFinalQuote(
    best?.amount_out ?? "",
    isLifi ? resolution.destination : undefined,
  )?.amount_out
  const requiredMinimum =
    data && isLifi
      ? formatSourceMin(data.required_min_received, resolution.route.src_decimals, "USDC")
      : ""

  const selectRoute = (option: BridgeOption) => {
    setValue("selectedBridge", option.bridge)
    setValue("page", "fields")
  }

  const renderList = () => {
    if (resolution.transport !== "lifi") return null
    // A failed refresh keeps the last good list on screen.
    if (error && !data) return <DepositStatus error>{userErrorMessage(error)}</DepositStatus>
    if (isLoading || isPlaceholderData) return <DepositStatus>Finding routes...</DepositStatus>
    if (!ranked.length) return <DepositStatus>No routes available for this amount</DepositStatus>

    return ranked.map((option) => (
      <RouteRow
        key={option.bridge}
        option={option}
        destination={resolution.destination}
        symbol={resolution.route.dst_symbol}
        isActive={option.bridge === activeOption?.bridge}
        isBest={option.bridge === best?.bridge}
        bestFinal={bestFinal}
        requiredMinimum={requiredMinimum}
        onSelect={() => selectRoute(option)}
      />
    ))
  }

  return (
    <DepositSubpage title="Select route" onBack={() => setValue("page", "fields")}>
      <p className={styles.explainer}>
        Best is the fastest route within 0.5% or $0.05 of the highest amount after gas.
      </p>
      <div className={providerStyles.header}>
        <span>Route</span>
        <span>You receive</span>
      </div>

      <DepositSubpage.List>{renderList()}</DepositSubpage.List>
    </DepositSubpage>
  )
}

export default SelectDepositRoute
