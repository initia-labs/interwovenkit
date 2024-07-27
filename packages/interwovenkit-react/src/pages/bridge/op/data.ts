import ky from "ky"
import { last } from "ramda"
import { concatBytes, utf8ToBytes } from "@noble/hashes/utils"
import { sha3_256 } from "@noble/hashes/sha3"
import { useMemo } from "react"
import { useSuspenseInfiniteQuery, useSuspenseQuery } from "@tanstack/react-query"
import { createQueryKeys } from "@lukemorales/query-key-factory"
import { useInitiaAddress } from "@/public/data/hooks"
import { STALE_TIMES } from "@/data/http"
import { useFindChain, useInitiaRegistry, useLayer1 } from "@/data/chains"

export const opQueryKeys = createQueryKeys("interwovenkit:op", {
  bridge: (bridgeId: number) => [bridgeId],
  withdrawals: (executorUrl: string, address: string) => [executorUrl, address],
  latestOutput: (bridgeId: number) => [bridgeId],
  output: (bridgeId: number, outputIndex: number) => [bridgeId, outputIndex],
  outputResponse: (executorUrl: string, sequence: number) => [executorUrl, sequence],
  withdrawalClaimed: (bridgeId: number, withdrawalHash: string) => [bridgeId, withdrawalHash],
})

function useLayer1RestClient() {
  const { restUrl } = useLayer1()
  return useMemo(() => ky.create({ prefixUrl: restUrl }), [restUrl])
}

interface OpBridge {
  bridge_id: string
  bridge_addr: string
  bridge_config: {
    challengers: string[]
    proposer: string
    batch_info: {
      submitter: string
      chain: string
    }
    submission_interval: string
    finalization_period: string
    submission_start_time: Date
    metadata: string
  }
}

export function useOpBridge(bridgeId: number) {
  const restClient = useLayer1RestClient()
  const { data } = useSuspenseQuery({
    queryKey: opQueryKeys.bridge(bridgeId).queryKey,
    queryFn: () => restClient.get(`opinit/ophost/v1/bridges/${bridgeId}`).json<OpBridge>(),
    staleTime: STALE_TIMES.INFINITY,
  })
  return data
}

interface WithdrawalTxListResponse {
  next: number
  withdrawals: WithdrawalTx[]
}

export interface WithdrawalTx {
  tx_hash: string
  sequence: number
  to: string
  from: string
  amount: {
    denom: string
    amount: string
  }
  output_index: number
  bridge_id: number
  withdrawal_proofs: string[]
  version: string
  storage_root: string
  last_block_hash: string
}
const LIMIT = 20

export function useWithdrawals(executorUrl: string) {
  const address = useInitiaAddress()
  return useSuspenseInfiniteQuery({
    queryKey: opQueryKeys.withdrawals(executorUrl, address).queryKey,
    queryFn: async ({ pageParam: offset }) => {
      if (!address) return []
      const searchParams = { limit: LIMIT, offset, order: "desc" }
      const { withdrawals } = await ky
        .create({ prefixUrl: executorUrl })
        .get(`withdrawals/${address}`, { searchParams })
        .json<WithdrawalTxListResponse>()
      return withdrawals
    },
    getNextPageParam: (data) => {
      const lastSequence = last(data)?.sequence
      if (data.length < LIMIT || !lastSequence || lastSequence <= 1) return null
      return lastSequence - 1
    },
    initialPageParam: 0,
    staleTime: STALE_TIMES.SECOND,
  })
}

interface Output {
  bridge_id: string
  output_index: string
  output_proposal: {
    output_root: string
    l1_block_time: Date
    l2_block_number: string
  }
}

export function useLatestOutput(bridgeId: number) {
  const restClient = useLayer1RestClient()
  const { data } = useSuspenseQuery({
    queryKey: opQueryKeys.latestOutput(bridgeId).queryKey,
    queryFn: () =>
      restClient
        .get(`opinit/ophost/v1/bridges/${bridgeId}/outputs`, {
          searchParams: { "pagination.reverse": true, "pagination.limit": 1 },
        })
        .json<{ output_proposals: Output[] }>(),
    select: ({ output_proposals }) => {
      const [output] = output_proposals
      if (!output) return null
      return output
    },
    staleTime: STALE_TIMES.SECOND,
  })
  return data
}

export function useOutput({ bridge_id, output_index }: WithdrawalTx) {
  const restClient = useLayer1RestClient()
  const { data } = useSuspenseQuery({
    queryKey: opQueryKeys.output(bridge_id, output_index).queryKey,
    queryFn: async () => {
      try {
        return await restClient
          .get(`opinit/ophost/v1/bridges/${bridge_id}/outputs/${output_index}`)
          .json<Output>()
      } catch {
        // ignore
        return null
      }
    },
    staleTime: STALE_TIMES.SECOND,
  })
  return data
}

interface OutputResponse {
  sequence: number
  to: string
  from: string
  amount: {
    denom: string
    amount: string
  }
  output_index: number
  bridge_id: number
  withdrawal_proofs: string[]
  version: string
  storage_root: string
  last_block_hash: string
}

export function useOutputResponse({ bridge_id, sequence }: WithdrawalTx) {
  const chains = useInitiaRegistry()
  const chainId = chains.find(
    ({ metadata }) => metadata?.op_bridge_id === bridge_id.toString(),
  )?.chain_id
  if (!chainId) throw new Error(`Chain not found for bridge_id: ${bridge_id}`)
  const findChain = useFindChain()
  const chain = findChain(chainId)
  if (!chain) throw new Error(`Chain not found: ${chainId}`)
  const executorUrl = chain.metadata?.executor_uri
  if (!executorUrl) throw new Error(`Executor URL not found: ${chainId}`)
  const { data } = useSuspenseQuery({
    queryKey: opQueryKeys.outputResponse(executorUrl, sequence).queryKey,
    queryFn: () =>
      ky.create({ prefixUrl: executorUrl }).get(`withdrawal/${sequence}`).json<OutputResponse>(),
    staleTime: STALE_TIMES.SECOND,
  })

  return data
}

export function useWithdrawalClaimed(withdrawalTx: WithdrawalTx, withdrawalHash: string) {
  const { bridge_id } = withdrawalTx
  const restClient = useLayer1RestClient()
  const { data } = useSuspenseQuery({
    queryKey: opQueryKeys.withdrawalClaimed(bridge_id, withdrawalHash).queryKey,
    queryFn: () =>
      restClient
        .get(`opinit/ophost/v1/bridges/${bridge_id}/withdrawals/claimed/by_hash`, {
          searchParams: { withdrawal_hash: withdrawalHash },
        })
        .json<{ claimed: boolean }>(),
    select: ({ claimed }) => claimed,
    staleTime: ({ state: { data } }) => (data?.claimed ? Infinity : STALE_TIMES.SECOND),
  })
  return data
}

/* utils */
function sha3(input: Uint8Array) {
  return sha3_256.create().update(input).digest()
}

function numberToBytes(value: string, size: number): Uint8Array {
  const buffer = new ArrayBuffer(size)
  new DataView(buffer).setBigUint64(0, BigInt(value), false)
  return new Uint8Array(buffer)
}

export function computeWithdrawalHash(withdrawalTx: WithdrawalTx) {
  const { bridge_id, sequence, amount, from, to } = withdrawalTx
  const bridgeIdBuffer = numberToBytes(bridge_id.toString(), 8)
  const sequenceBuffer = numberToBytes(sequence.toString(), 8)
  const amountBuffer = numberToBytes(amount.amount, 8)
  const buffer = concatBytes(
    bridgeIdBuffer,
    sequenceBuffer,
    sha3(utf8ToBytes(from)),
    sha3(utf8ToBytes(to)),
    sha3(utf8ToBytes(amount.denom)),
    amountBuffer,
  )
  return sha3(sha3(buffer))
}
