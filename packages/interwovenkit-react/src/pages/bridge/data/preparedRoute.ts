import type { TxJson } from "@skip-go/client"
import type { FormValues } from "./form"
import {
  useBridgeAddressListQuery,
  useBridgeErc20ApprovalsQuery,
  useBridgeTxQuery,
  useExactFeeCheckQuery,
} from "./preparation"
import type { RouterRouteResponseJson } from "./simulate"
import type { SignedOpHook } from "./tx"

interface SharedOptions {
  route: RouterRouteResponseJson | undefined
  values: Pick<
    FormValues,
    "srcChainId" | "dstChainId" | "sender" | "recipient" | "slippagePercent" | "srcDenom"
  >
  signedOpHook?: SignedOpHook
}

interface BridgeRoutePreparationStateParams {
  addressList: string[] | undefined
  approvalError: Error | null
  balancesError: Error | null
  blockingError: Error | null
  exactFeeError: Error | null
  hasApprovalData: boolean
  isCheckingApprovals: boolean
  isCheckingFeeBalance: boolean
  isLoadingAddressList: boolean
  isLoadingTx: boolean
  isRoutePreparingTx: boolean
  requiresExactFeeCheck: boolean
  route: RouterRouteResponseJson | undefined
  tx: TxJson | undefined
}

function requiresBridgeApprovalCheck(tx: TxJson | undefined): boolean {
  return !!tx && "evm_tx" in tx && !!tx.evm_tx.required_erc20_approvals?.length
}

export function getBridgeRoutePreparationState({
  addressList,
  approvalError,
  balancesError,
  blockingError,
  exactFeeError,
  hasApprovalData,
  isCheckingApprovals,
  isCheckingFeeBalance,
  isLoadingAddressList,
  isLoadingTx,
  isRoutePreparingTx,
  requiresExactFeeCheck,
  route,
  tx,
}: BridgeRoutePreparationStateParams) {
  const needsTx = !!route && !route.required_op_hook
  const needsApprovalCheck = requiresBridgeApprovalCheck(tx)
  const isPreparing =
    isLoadingAddressList ||
    isLoadingTx ||
    isRoutePreparingTx ||
    (requiresExactFeeCheck && isCheckingFeeBalance) ||
    (needsApprovalCheck && isCheckingApprovals)
  const hasBlockingError =
    !!blockingError ||
    (requiresExactFeeCheck && (!!balancesError || !!exactFeeError)) ||
    (needsApprovalCheck && !!approvalError)
  const isReady =
    !!route &&
    !!addressList &&
    !hasBlockingError &&
    !isPreparing &&
    (!needsTx || !!tx) &&
    (!needsApprovalCheck || hasApprovalData)

  return {
    hasBlockingError,
    isPreparing,
    isReady,
    tx,
  }
}

export function useBridgeRoutePreparation({ route, values, signedOpHook }: SharedOptions) {
  const addressListQuery = useBridgeAddressListQuery(route, values, { background: true })
  const txQuery = useBridgeTxQuery(route, values, addressListQuery.data, signedOpHook)
  const exactFeeQuery = useExactFeeCheckQuery(route, values, txQuery.data)
  const approvalQuery = useBridgeErc20ApprovalsQuery(txQuery.data)

  return getBridgeRoutePreparationState({
    addressList: addressListQuery.data,
    approvalError: approvalQuery.error,
    balancesError: exactFeeQuery.balancesError,
    blockingError: addressListQuery.error ?? txQuery.error,
    exactFeeError: exactFeeQuery.error,
    hasApprovalData: approvalQuery.data !== undefined,
    isCheckingApprovals: approvalQuery.isLoading,
    isCheckingFeeBalance: exactFeeQuery.isLoading || exactFeeQuery.isLoadingBalances,
    isLoadingAddressList: addressListQuery.isLoading,
    isLoadingTx: txQuery.isLoading,
    isRoutePreparingTx: txQuery.isFetching,
    requiresExactFeeCheck: exactFeeQuery.requiresExactFeeCheck,
    route,
    tx: txQuery.data,
  })
}
