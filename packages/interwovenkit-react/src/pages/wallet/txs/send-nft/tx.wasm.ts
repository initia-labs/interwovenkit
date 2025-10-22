import { toBase64 } from "@cosmjs/encoding"
import { toBytes, utf8ToBytes } from "@noble/hashes/utils"
import ky from "ky"
import { InitiaAddress } from "@initia/utils"
import type { NormalizedChain } from "@/data/chains"
import type { NormalizedNft } from "../../tabs/nft/queries"

// CosmWasm contract의 contract_info를 query하여 collection 이름 조회
async function fetchCollectionNameMiniwasm(contractAddr: string, restUrl: string) {
  const queryData = toBase64(utf8ToBytes(JSON.stringify({ contract_info: {} })))

  const { data } = await ky
    .create({ prefixUrl: restUrl })
    .get(`cosmwasm/wasm/v1/contract/${contractAddr}/smart/${queryData}`)
    .json<{ data: { name: string } }>()

  return data.name
}

// collection creator address를 조회하여 이 chain이 original creator인지 판별
async function fetchCollectionCreatorAddress(objectAddr: string, indexerUrl: string) {
  const { collection } = await ky
    .create({ prefixUrl: indexerUrl })
    .get(`indexer/nft/v1/collections/${objectAddr}`)
    .json<{ collection: { collection: { creator: string } } }>()

  return collection.collection.creator
}

// IBC path를 channel routing path와 base class ID로 분리
// 예: "transfer/channel-0/transfer/channel-5/my-nft" -> ["transfer/channel-0/transfer/channel-5", "my-nft"]
function parseIbcPath(ibcPath: string) {
  const regex = /^(.*channel-\d+)\/(.*)$/
  const match = ibcPath.match(regex)

  if (!match) throw new Error("Pattern `channel-{number}/` not found.")

  const [, channelPath, baseClassId] = match
  return [channelPath, baseClassId]
}

// MiniWasm NFT transfer를 위한 class_id와 class_trace 결정
// MiniWasm은 ICS721 (CosmWasm NFT standard)을 사용하므로 IBC transfer contract를 통한 class ID mapping 필요
export async function handleMiniwasm(
  { collection_addr: collectionAddr }: NormalizedNft,
  srcChain: NormalizedChain,
  intermediaryChain: NormalizedChain,
) {
  const contractAddr = InitiaAddress(collectionAddr).bech32
  const collectionName = await fetchCollectionNameMiniwasm(contractAddr, srcChain.restUrl)

  // Step 1: intermediary chain으로의 IBC channel 탐색
  const nftTransferChannel = srcChain.metadata?.ibc_channels?.find(
    ({ chain_id, version }) =>
      chain_id === intermediaryChain.chain_id && version.includes("ics721-1"),
  )
  if (!nftTransferChannel) throw new Error("Channel not found")

  // Step 2: ICS721 transfer contract에서 local class ID를 IBC class ID로 mapping
  const portId = nftTransferChannel.port_id
  const ics721ContractAddr = portId.split(".")[1]

  const queryData = toBase64(toBytes(JSON.stringify({ class_id: { contract: contractAddr } })))
  const { data: ibcClassId } = await ky
    .create({ prefixUrl: srcChain.restUrl })
    .get(`cosmwasm/wasm/v1/contract/${ics721ContractAddr}/smart/${queryData}`)
    .json<{ data: string | null }>()

  const classId = ibcClassId ?? contractAddr

  // Step 3: collection creator 확인하여 origin chain 판별
  const creatorAddr = await fetchCollectionCreatorAddress(contractAddr, srcChain.indexerUrl)

  // Case 1: origin chain
  if (classId === contractAddr) {
    return {
      class_id: classId,
      class_trace: undefined,
    }
  }

  // Case 2: intermediary chain (creator가 ICS721 contract가 아님)
  if (ibcClassId && creatorAddr !== portId.replace("wasm.", "")) {
    const [path, baseClassId] = parseIbcPath(ibcClassId)
    return {
      class_id: contractAddr,
      class_trace: { path, base_class_id: baseClassId },
    }
  }

  // Case 3: first receiver
  const [path, baseClassId] = parseIbcPath(collectionName)
  return {
    class_id: contractAddr,
    class_trace: { path, base_class_id: baseClassId },
  }
}
