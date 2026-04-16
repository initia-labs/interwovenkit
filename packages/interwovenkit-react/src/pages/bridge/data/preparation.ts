import { encodeSecp256k1Pubkey, pubkeyToAddress } from "@cosmjs/amino"
import { fromBech32, toBech32 } from "@cosmjs/encoding"
import type { EncodeObject } from "@cosmjs/proto-signing"
import type { BalanceResponseDenomEntryJson, TxJson } from "@skip-go/client"
import { ethers } from "ethers"
import type { KyInstance } from "ky"
import type { QueryClient } from "@tanstack/react-query"
import { useQuery } from "@tanstack/react-query"
import { createQueryKeys } from "@lukemorales/query-key-factory"
import { InitiaAddress } from "@initia/utils"
import { type NormalizedChain, useChainEnabled, type useFindChain } from "@/data/chains"
import { fetchGasPrices } from "@/data/fee"
import { normalizeError, STALE_TIMES } from "@/data/http"
import {
  useAminoConverters,
  useAminoTypes,
  useCreateSigningStargateClient,
  useOfflineSigner,
} from "@/data/signer"
import { useInterwovenKit } from "@/public/data/hooks"
import { fetchSkipBalancesForChain, useSkipBalancesQuery } from "./balance"
import {
  computeRequiredFeeByDenom,
  decodeCosmosAminoMessages,
  fetchBridgeTxs,
  hasSufficientFeeBalance,
} from "./bridgeTxUtils"
import { useChainType, useFindChainType, useFindSkipChain, useSkipChain } from "./chains"
import { shouldCheckExactFee, shouldRunExactFeeQuery } from "./exactFeeCheck"
import type { FormValues } from "./form"
import type { RouterRouteResponseJson } from "./simulate"
import { skipQueryKeys, useSkip } from "./skip"
import type { SignedOpHook } from "./tx"

const ERC20_ALLOWANCE_ABI = [
  "function allowance(address owner, address spender) view returns (uint256)",
]
const ERC20_APPROVALS_QUERY_KEY = "interwovenkit:erc20-approvals-needed"

interface Erc20Approval {
  amount: string
  spender: string
  token_contract: string
}

type EvmBridgeTx = TxJson & {
  evm_tx: {
    chain_id: string
    required_erc20_approvals?: Erc20Approval[]
    signer_address: string
  }
}

const queryKeys = createQueryKeys("interwovenkit:bridge-preparation", {
  addressList: (params: {
    requiredChainAddresses: string[]
    srcChainId: string
    dstChainId: string
    sender: string
    recipient: string
    initiaAddress: string
    hexAddress: string
  }) => [params],
  tx: (params: {
    addressList: string[]
    routeSignature: string
    slippagePercent: string
    signedOpHook?: SignedOpHook
  }) => [params],
  exactFeeCheck: (params: {
    tx: TxJson
    sender: string
    srcChainId: string
    srcDenom: string
    routeAmountIn: string
    balanceKey: string
  }) => [params],
})

// Stable identity for React Query cache keys when building bridge txs from a route.
// Intentionally narrower than `getRouteSignature` in `useRouteRefresh.ts`, which
// compares many more fields (fees, warnings, USD, duration) to decide whether a
// refreshed route "meaningfully" changed for preview navigation — do not unify
// without revisiting both call sites.
function getBridgePreparationRouteKey(route: RouterRouteResponseJson): string {
  return JSON.stringify({
    amount_in: route.amount_in,
    amount_out: route.amount_out,
    source_asset_chain_id: route.source_asset_chain_id,
    source_asset_denom: route.source_asset_denom,
    dest_asset_chain_id: route.dest_asset_chain_id,
    dest_asset_denom: route.dest_asset_denom,
    operations: route.operations,
    required_op_hook: route.required_op_hook,
  })
}

function getFeeBalanceKey({
  balances,
  feeDenoms,
}: {
  balances?: Record<string, { amount?: string }>
  feeDenoms: string[]
}): string {
  if (!balances) return ""

  return feeDenoms
    .toSorted()
    .map((denom) => `${denom}:${balances[denom]?.amount ?? "0"}`)
    .join("|")
}

async function getBridgeAddressList({
  route,
  values,
  initiaAddress,
  hexAddress,
  signer,
  findSkipChain,
  findChainType,
}: {
  route: RouterRouteResponseJson
  values: Pick<FormValues, "srcChainId" | "dstChainId" | "sender" | "recipient">
  initiaAddress: string
  hexAddress: string
  signer: ReturnType<typeof useOfflineSigner>
  findSkipChain: ReturnType<typeof useFindSkipChain>
  findChainType: ReturnType<typeof useFindChainType>
}): Promise<string[]> {
  const { required_chain_addresses } = route
  const { srcChainId, dstChainId, sender, recipient } = values

  const srcChain = findSkipChain(srcChainId)
  const srcChainType = findChainType(srcChain)
  const isPubkeyRequired = requiresBridgeAddressPubkey({
    route,
    srcChainId,
    findSkipChain,
    findChainType,
  })

  let pubkey: Uint8Array | undefined

  if (isPubkeyRequired) {
    if (!signer) throw new Error("Wallet not connected")
    const [{ pubkey: signerPubkey }] = await signer.getAccounts()
    pubkey = signerPubkey
  }

  return required_chain_addresses.map((chainId, index) => {
    if (index === required_chain_addresses.length - 1) {
      const dstChain = findSkipChain(dstChainId)
      const dstChainType = findChainType(dstChain)
      if (dstChainType === "initia") return InitiaAddress(recipient).bech32
      return recipient
    }

    const chain = findSkipChain(chainId)
    const chainType = findChainType(chain)

    switch (chainType) {
      case "initia":
        return initiaAddress
      case "evm":
        return hexAddress
      case "cosmos": {
        if (srcChainType === "cosmos") {
          return toBech32(chain.bech32_prefix, fromBech32(sender).data)
        }
        if (!pubkey) throw new Error("Pubkey not found")
        return pubkeyToAddress(encodeSecp256k1Pubkey(pubkey), chain.bech32_prefix)
      }
      default:
        throw new Error("Unlisted chain type")
    }
  })
}

function hasCosmosIntermediary({
  route,
  findSkipChain,
  findChainType,
}: {
  route: RouterRouteResponseJson
  findSkipChain: ReturnType<typeof useFindSkipChain>
  findChainType: ReturnType<typeof useFindChainType>
}): boolean {
  return route.required_chain_addresses.slice(0, -1).some((chainId) => {
    const chain = findSkipChain(chainId)
    return findChainType(chain) === "cosmos"
  })
}

function requiresBridgeAddressPubkey({
  route,
  srcChainId,
  findSkipChain,
  findChainType,
}: {
  route: RouterRouteResponseJson
  srcChainId: string
  findSkipChain: ReturnType<typeof useFindSkipChain>
  findChainType: ReturnType<typeof useFindChainType>
}): boolean {
  const srcChain = findSkipChain(srcChainId)
  const srcChainType = findChainType(srcChain)

  return hasCosmosIntermediary({ route, findSkipChain, findChainType }) && srcChainType !== "cosmos"
}

export function createBridgeAddressListQueryOptions({
  route,
  values,
  initiaAddress,
  hexAddress,
  signer,
  findSkipChain,
  findChainType,
  background,
}: {
  route: RouterRouteResponseJson | undefined
  values: Pick<FormValues, "srcChainId" | "dstChainId" | "sender" | "recipient">
  initiaAddress: string
  hexAddress: string
  signer: ReturnType<typeof useOfflineSigner>
  findSkipChain: ReturnType<typeof useFindSkipChain>
  findChainType: ReturnType<typeof useFindChainType>
  background?: boolean
}) {
  const requiresPubkey =
    !!route &&
    requiresBridgeAddressPubkey({
      route,
      srcChainId: values.srcChainId,
      findSkipChain,
      findChainType,
    })
  const isBackgroundBlocked = !!background && requiresPubkey

  return {
    // eslint-disable-next-line @tanstack/query/exhaustive-deps -- route identity is encoded in requiredChainAddresses and routeSignature downstream
    queryKey: queryKeys.addressList({
      requiredChainAddresses: route?.required_chain_addresses ?? [],
      srcChainId: values.srcChainId,
      dstChainId: values.dstChainId,
      sender: values.sender,
      recipient: values.recipient,
      initiaAddress,
      hexAddress,
    }).queryKey,
    queryFn: async () => {
      if (!route) throw new Error("Route not found")
      try {
        return await getBridgeAddressList({
          route,
          values,
          initiaAddress,
          hexAddress,
          signer,
          findSkipChain,
          findChainType,
        })
      } catch (error) {
        throw await normalizeError(error)
      }
    },
    enabled: !!route && !!values.sender && !!values.recipient && !isBackgroundBlocked,
    staleTime: STALE_TIMES.MINUTE,
  }
}

export function createBridgeTxQueryOptions({
  skip,
  route,
  values,
  addressList,
  signedOpHook,
}: {
  skip: KyInstance
  route: RouterRouteResponseJson
  values: Pick<FormValues, "slippagePercent">
  addressList: string[]
  signedOpHook?: SignedOpHook
}) {
  return {
    queryKey: queryKeys.tx({
      addressList,
      routeSignature: getBridgePreparationRouteKey(route),
      slippagePercent: String(values.slippagePercent),
      signedOpHook,
    }).queryKey,
    queryFn: async () => {
      try {
        if (route.required_op_hook && !signedOpHook) {
          throw new Error("Op hook is required")
        }
        const [tx] = await fetchBridgeTxs(skip, {
          addressList,
          route: {
            amount_in: route.amount_in,
            amount_out: route.amount_out,
            source_asset_chain_id: route.source_asset_chain_id,
            source_asset_denom: route.source_asset_denom,
            dest_asset_chain_id: route.dest_asset_chain_id,
            dest_asset_denom: route.dest_asset_denom,
            operations: route.operations,
          },
          slippagePercent: String(values.slippagePercent),
          signedOpHook,
        })
        return tx
      } catch (error) {
        throw await normalizeError(error)
      }
    },
    enabled: addressList.length > 0 && (!route.required_op_hook || !!signedOpHook),
    staleTime: STALE_TIMES.MINUTE,
  }
}

export function getBridgeErc20ApprovalsQueryKey(tx: TxJson | undefined) {
  return [ERC20_APPROVALS_QUERY_KEY, tx] as const
}

function isEvmBridgeTx(tx: TxJson | undefined): tx is EvmBridgeTx {
  return !!tx && "evm_tx" in tx
}

async function getPendingErc20Approvals({ tx, rpc }: { tx: EvmBridgeTx; rpc: string }) {
  if (!tx.evm_tx.required_erc20_approvals?.length) return []

  const provider = new ethers.JsonRpcProvider(rpc)
  const { signer_address } = tx.evm_tx
  const approvalsWithAllowance = await Promise.all(
    tx.evm_tx.required_erc20_approvals.map(async (approval: Erc20Approval) => {
      const tokenContract = new ethers.Contract(
        approval.token_contract,
        ERC20_ALLOWANCE_ABI,
        provider,
      )
      const currentAllowance = await tokenContract.allowance(signer_address, approval.spender)
      return { approval, currentAllowance: BigInt(currentAllowance.toString()) }
    }),
  )

  return approvalsWithAllowance
    .filter(
      ({ approval, currentAllowance }: { approval: Erc20Approval; currentAllowance: bigint }) =>
        currentAllowance < BigInt(approval.amount),
    )
    .map(({ approval }: { approval: Erc20Approval }) => approval)
}

export function useBridgeAddressListQuery(
  route: RouterRouteResponseJson | undefined,
  values: Pick<FormValues, "srcChainId" | "dstChainId" | "sender" | "recipient">,
  options?: { background?: boolean },
) {
  const { initiaAddress, hexAddress } = useInterwovenKit()
  const signer = useOfflineSigner()
  const findSkipChain = useFindSkipChain()
  const findChainType = useFindChainType()

  return useQuery({
    ...createBridgeAddressListQueryOptions({
      route,
      values,
      initiaAddress,
      hexAddress,
      signer,
      findSkipChain,
      findChainType,
      background: options?.background,
    }),
  })
}

export function useBridgeTxQuery(
  route: RouterRouteResponseJson | undefined,
  values: Pick<FormValues, "slippagePercent">,
  addressList: string[] | undefined,
  signedOpHook?: SignedOpHook,
) {
  const skip = useSkip()
  const txOptions =
    route && addressList?.length
      ? createBridgeTxQueryOptions({
          skip,
          route,
          values,
          addressList,
          signedOpHook,
        })
      : {
          queryKey: queryKeys.tx({
            addressList: addressList ?? [],
            routeSignature: "missing-route",
            slippagePercent: String(values.slippagePercent),
            signedOpHook,
          }).queryKey,
          queryFn: async () => {
            throw new Error("Route not found")
          },
          enabled: false,
          staleTime: STALE_TIMES.MINUTE,
        }

  return useQuery({
    ...txOptions,
    enabled: !!route && !!addressList?.length && (!route.required_op_hook || !!signedOpHook),
  })
}

export function createBridgeErc20ApprovalsQueryOptions({
  tx,
  findSkipChain,
}: {
  tx: TxJson | undefined
  findSkipChain: ReturnType<typeof useFindSkipChain>
}) {
  const evmTx = isEvmBridgeTx(tx) ? tx : undefined
  const chain = evmTx ? findSkipChain(evmTx.evm_tx.chain_id) : undefined

  return {
    // eslint-disable-next-line @tanstack/query/exhaustive-deps -- evmTx is derived from tx; chain?.rpc is tracked explicitly for allowance reads
    queryKey: [...getBridgeErc20ApprovalsQueryKey(tx), chain?.rpc],
    queryFn: async () => {
      if (!evmTx) return []
      if (!evmTx.evm_tx.required_erc20_approvals?.length) return []
      if (!chain?.rpc) throw new Error(`RPC not found for chain: ${evmTx.evm_tx.chain_id}`)

      try {
        return await getPendingErc20Approvals({ tx: evmTx, rpc: chain.rpc })
      } catch (error) {
        throw await normalizeError(error)
      }
    },
    enabled: !!evmTx && !!evmTx.evm_tx.required_erc20_approvals?.length,
    staleTime: STALE_TIMES.MINUTE,
  }
}

export function useBridgeErc20ApprovalsQuery(tx: TxJson | undefined) {
  const findSkipChain = useFindSkipChain()

  return useQuery({
    ...createBridgeErc20ApprovalsQueryOptions({ tx, findSkipChain }),
  })
}

async function fetchBridgeExactFeeCheck({
  route,
  tx,
  sender,
  srcChainId,
  srcDenom,
  balances,
  chain,
  aminoConverters,
  aminoTypes,
  createSigningStargateClient,
}: {
  route: RouterRouteResponseJson
  tx: TxJson
  sender: string
  srcChainId: string
  srcDenom: string
  balances: Record<string, BalanceResponseDenomEntryJson>
  chain: NormalizedChain
  aminoConverters: ReturnType<typeof useAminoConverters>
  aminoTypes: ReturnType<typeof useAminoTypes>
  createSigningStargateClient: ReturnType<typeof useCreateSigningStargateClient>
}) {
  try {
    if (!("cosmos_tx" in tx) || !tx.cosmos_tx.msgs?.length) {
      throw new Error("Invalid transaction data")
    }

    const messages: EncodeObject[] = decodeCosmosAminoMessages(tx.cosmos_tx.msgs, {
      converters: aminoConverters,
      fromAmino: aminoTypes.fromAmino.bind(aminoTypes),
    })
    const client = await createSigningStargateClient(srcChainId)
    const gas = await client.simulate(sender, messages, "")
    const gasPrices = await fetchGasPrices(chain)
    const requiredFeeByDenom = computeRequiredFeeByDenom({ gas, gasPrices })

    return hasSufficientFeeBalance({
      balances,
      requiredFeeByDenom,
      sourceDenom: srcDenom,
      amountIn: route.amount_in,
    })
  } catch (error) {
    throw await normalizeError(error)
  }
}

export function createExactFeeCheckQueryOptions({
  route,
  tx,
  sender,
  srcChainId,
  srcDenom,
  balances,
  chain,
  aminoConverters,
  aminoTypes,
  createSigningStargateClient,
}: {
  route: RouterRouteResponseJson | undefined
  tx: TxJson | undefined
  sender: string
  srcChainId: string
  srcDenom: string
  balances?: Record<string, BalanceResponseDenomEntryJson>
  chain?: NormalizedChain
  aminoConverters: ReturnType<typeof useAminoConverters>
  aminoTypes: ReturnType<typeof useAminoTypes>
  createSigningStargateClient: ReturnType<typeof useCreateSigningStargateClient>
}) {
  const feeDenoms = chain
    ? Array.from(new Set([srcDenom, ...chain.fees.fee_tokens.map(({ denom }) => denom)]))
    : []
  const balanceKey = getFeeBalanceKey({ balances, feeDenoms })

  return {
    // eslint-disable-next-line @tanstack/query/exhaustive-deps -- tx and route identity are reduced into the exact-fee key fields above; the remaining inputs are execution dependencies
    queryKey:
      route && tx
        ? queryKeys.exactFeeCheck({
            tx,
            sender,
            srcChainId,
            srcDenom,
            routeAmountIn: route.amount_in,
            balanceKey,
          }).queryKey
        : ["interwovenkit:bridge-preparation", "exactFeeCheck", "missing"],
    queryFn: async () => {
      if (!(route && tx && chain && balances)) {
        throw new Error("Invalid transaction data")
      }

      return fetchBridgeExactFeeCheck({
        route,
        tx,
        sender,
        srcChainId,
        srcDenom,
        balances,
        chain,
        aminoConverters,
        aminoTypes,
        createSigningStargateClient,
      })
    },
    retry: false,
    staleTime: STALE_TIMES.MINUTE,
  }
}

export async function prefetchBridgeExactFeeCheck({
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
}: {
  queryClient: QueryClient
  skip: KyInstance
  route: RouterRouteResponseJson
  values: Pick<FormValues, "sender" | "recipient" | "srcChainId" | "dstChainId" | "srcDenom">
  tx: TxJson
  findSkipChain: ReturnType<typeof useFindSkipChain>
  findChainType: ReturnType<typeof useFindChainType>
  findChain: ReturnType<typeof useFindChain>
  aminoConverters: ReturnType<typeof useAminoConverters>
  aminoTypes: ReturnType<typeof useAminoTypes>
  createSigningStargateClient: ReturnType<typeof useCreateSigningStargateClient>
}) {
  const srcChain = findSkipChain(values.srcChainId)
  const dstChain = findSkipChain(values.dstChainId)
  const requiresExactFeeCheck = shouldCheckExactFee({
    route,
    tx,
    isSrcInitia: findChainType(srcChain) === "initia",
    isDstInitia: findChainType(dstChain) === "initia",
    sender: values.sender,
    recipient: values.recipient,
  })

  if (!requiresExactFeeCheck) return

  const chain = findChain(values.srcChainId)
  const balances = await queryClient.fetchQuery({
    // eslint-disable-next-line @tanstack/query/exhaustive-deps -- skip is a stable ky instance from useMemo
    queryKey: skipQueryKeys.balances(values.srcChainId, values.sender).queryKey,
    queryFn: () => fetchSkipBalancesForChain(skip, values.srcChainId, values.sender),
    staleTime: STALE_TIMES.SECOND,
  })

  await queryClient.fetchQuery(
    createExactFeeCheckQueryOptions({
      route,
      tx,
      sender: values.sender,
      srcChainId: values.srcChainId,
      srcDenom: values.srcDenom,
      balances,
      chain,
      aminoConverters,
      aminoTypes,
      createSigningStargateClient,
    }),
  )
}

export function useExactFeeCheckQuery(
  route: RouterRouteResponseJson | undefined,
  values: Pick<FormValues, "sender" | "recipient" | "srcChainId" | "dstChainId" | "srcDenom">,
  tx: TxJson | undefined,
) {
  const { sender, recipient, srcChainId, dstChainId, srcDenom } = values
  const srcChain = useSkipChain(srcChainId)
  const dstChain = useSkipChain(dstChainId)
  const srcChainType = useChainType(srcChain)
  const dstChainType = useChainType(dstChain)
  const {
    data: balances,
    isLoading: isLoadingBalances,
    error: balancesError,
  } = useSkipBalancesQuery(sender, srcChainId)
  const aminoConverters = useAminoConverters()
  const aminoTypes = useAminoTypes()
  const createSigningStargateClient = useCreateSigningStargateClient()

  const requiresExactFeeCheck =
    !!tx &&
    shouldCheckExactFee({
      route,
      tx,
      isSrcInitia: srcChainType === "initia",
      isDstInitia: dstChainType === "initia",
      sender,
      recipient,
    })

  const {
    chain,
    error: chainError,
    isLoading: isLoadingChain,
  } = useChainEnabled(srcChainId, requiresExactFeeCheck)
  const shouldRunFeeQuery = shouldRunExactFeeQuery({
    hasBalances: balances !== undefined,
    hasChain: !!chain,
    requiresExactFeeCheck,
  })

  const { data, error, isLoading } = useQuery({
    ...createExactFeeCheckQueryOptions({
      route,
      tx,
      sender,
      srcChainId,
      srcDenom,
      balances,
      chain,
      aminoConverters,
      aminoTypes,
      createSigningStargateClient,
    }),
    enabled: shouldRunFeeQuery,
  })

  return {
    data,
    error,
    isLoading,
    balances,
    balancesError,
    isLoadingBalances,
    requiresExactFeeCheck,
    chainError,
    isLoadingChain,
  }
}
