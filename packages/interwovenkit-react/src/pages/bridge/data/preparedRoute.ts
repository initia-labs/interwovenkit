import type { KyInstance } from "ky"
import type { QueryClient } from "@tanstack/react-query"
import type { useFindChain } from "@/data/chains"
import type {
  OfflineSigner,
  useAminoConverters,
  useAminoTypes,
  useCreateSigningStargateClient,
} from "@/data/signer"
import type { useFindChainType, useFindSkipChain } from "./chains"
import type { FormValues } from "./form"
import {
  createBridgeAddressListQueryOptions,
  createBridgeErc20ApprovalsQueryOptions,
  createBridgeTxQueryOptions,
  prefetchBridgeExactFeeCheck,
  useBridgeAddressListQuery,
  useBridgeErc20ApprovalsQuery,
  useBridgeTxQuery,
} from "./preparation"
import type { RouterRouteResponseJson } from "./simulate"
import type { SignedOpHook } from "./tx"

interface PrewarmOptions {
  route: RouterRouteResponseJson | undefined
  values: Pick<FormValues, "srcChainId" | "dstChainId" | "sender" | "recipient" | "slippagePercent">
  signedOpHook?: SignedOpHook
}

export async function prefetchBridgeRoutePreparation({
  queryClient,
  skip,
  route,
  values,
  signedOpHook,
  initiaAddress,
  hexAddress,
  signer,
  findSkipChain,
  findChainType,
  findChain,
  aminoConverters,
  aminoTypes,
  createSigningStargateClient,
}: {
  queryClient: QueryClient
  skip: KyInstance
  route: RouterRouteResponseJson
  values: Pick<
    FormValues,
    "srcChainId" | "dstChainId" | "sender" | "recipient" | "slippagePercent" | "srcDenom"
  >
  signedOpHook?: SignedOpHook
  initiaAddress: string
  hexAddress: string
  signer: OfflineSigner
  findSkipChain: ReturnType<typeof useFindSkipChain>
  findChainType: ReturnType<typeof useFindChainType>
  findChain: ReturnType<typeof useFindChain>
  aminoConverters: ReturnType<typeof useAminoConverters>
  aminoTypes: ReturnType<typeof useAminoTypes>
  createSigningStargateClient: ReturnType<typeof useCreateSigningStargateClient>
}) {
  const addressList = await queryClient.fetchQuery(
    createBridgeAddressListQueryOptions({
      route,
      values,
      initiaAddress,
      hexAddress,
      signer,
      findSkipChain,
      findChainType,
    }),
  )
  // Mirror useBridgeTxQuery: do not fetch messages until required_op_hook is
  // satisfied (fetchQuery ignores `enabled`, so we must branch here).
  const canPrefetchTx = !route.required_op_hook || !!signedOpHook
  if (!canPrefetchTx) return

  const tx = await queryClient.fetchQuery(
    createBridgeTxQueryOptions({
      skip,
      route,
      values,
      addressList,
      signedOpHook,
    }),
  )

  await prefetchBridgeExactFeeCheck({
    queryClient,
    skip,
    route,
    values,
    tx,
    findSkipChain,
    findChainType,
    findChain,
    aminoConverters,
    aminoTypes,
    createSigningStargateClient,
  })

  if ("evm_tx" in tx && tx.evm_tx.required_erc20_approvals?.length) {
    await queryClient.fetchQuery(createBridgeErc20ApprovalsQueryOptions({ tx, findSkipChain }))
  }
}

/** Runs non-interactive preparation queries in the background. */
export function useBridgeRoutePreparationPrewarm({
  route,
  values,
  signedOpHook,
}: PrewarmOptions): void {
  const addressListQuery = useBridgeAddressListQuery(route, values, { background: true })
  const txQuery = useBridgeTxQuery(route, values, addressListQuery.data, signedOpHook)

  void useBridgeErc20ApprovalsQuery(txQuery.data)
}
