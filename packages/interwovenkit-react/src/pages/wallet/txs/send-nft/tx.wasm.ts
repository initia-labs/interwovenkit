import { toBase64 } from "@cosmjs/encoding"
import { toBytes, utf8ToBytes } from "@noble/hashes/utils"
import ky from "ky"
import { InitiaAddress } from "@initia/utils"
import type { NormalizedChain } from "@/data/chains"
import type { NormalizedNft } from "../../tabs/nft/queries"

// Query contract_info of CosmWasm contract to retrieve collection name
async function fetchCollectionNameMiniwasm(contractAddr: string, restUrl: string) {
  const queryData = toBase64(utf8ToBytes(JSON.stringify({ contract_info: {} })))

  const { data } = await ky
    .create({ prefixUrl: restUrl })
    .get(`cosmwasm/wasm/v1/contract/${contractAddr}/smart/${queryData}`)
    .json<{ data: { name: string } }>()

  return data.name
}

// Query collection creator address to determine if this chain is the original creator
async function fetchCollectionCreatorAddress(objectAddr: string, indexerUrl: string) {
  const { collection } = await ky
    .create({ prefixUrl: indexerUrl })
    .get(`indexer/nft/v1/collections/${objectAddr}`)
    .json<{ collection: { collection: { creator: string } } }>()

  return collection.collection.creator
}

// Query outgoing proxy contract address from ICS721 contract
export async function fetchOutgoingProxyContract(
  ics721ContractAddr: string,
  restUrl: string,
): Promise<string | null> {
  const queryData = toBase64(toBytes(JSON.stringify({ outgoing_proxy: {} })))
  const { data: outgoingProxy } = await ky
    .create({ prefixUrl: restUrl })
    .get(`cosmwasm/wasm/v1/contract/${ics721ContractAddr}/smart/${queryData}`)
    .json<{ data: string | null }>()
  return outgoingProxy
}

// Parse IBC path into channel routing path and base class ID
// Example: "transfer/channel-0/transfer/channel-5/my-nft" -> ["transfer/channel-0/transfer/channel-5", "my-nft"]
function parseIbcPath(ibcPath: string) {
  const regex = /^(.*channel-\d+)\/(.*)$/
  const match = ibcPath.match(regex)

  if (!match) throw new Error("Pattern `channel-{number}/` not found.")

  const [, channelPath, baseClassId] = match
  return [channelPath, baseClassId]
}

// Determine class_id and class_trace for MiniWasm NFT transfer
// MiniWasm uses ICS721 (CosmWasm NFT standard), requiring class ID mapping through IBC transfer contract
export async function handleMiniwasm(
  { collection_addr: collectionAddr }: NormalizedNft,
  srcChain: NormalizedChain,
  intermediaryChain: NormalizedChain,
) {
  const contractAddr = InitiaAddress(collectionAddr).bech32
  const collectionName = await fetchCollectionNameMiniwasm(contractAddr, srcChain.restUrl)

  // Step 1: Search for IBC channel to intermediary chain
  const nftTransferChannel = srcChain.metadata?.ibc_channels?.find(
    ({ chain_id, version }) =>
      chain_id === intermediaryChain.chain_id && version.includes("ics721-1"),
  )
  if (!nftTransferChannel) throw new Error("Channel not found")

  // Step 2: Map local class ID to IBC class ID in ICS721 transfer contract
  const portId = nftTransferChannel.port_id
  const ics721ContractAddr = portId.split(".")[1]

  const queryData = toBase64(toBytes(JSON.stringify({ class_id: { contract: contractAddr } })))
  const { data: ibcClassId } = await ky
    .create({ prefixUrl: srcChain.restUrl })
    .get(`cosmwasm/wasm/v1/contract/${ics721ContractAddr}/smart/${queryData}`)
    .json<{ data: string | null }>()

  const classId = ibcClassId ?? contractAddr

  // Step 3: Query outgoing proxy contract
  const outgoingProxy = await fetchOutgoingProxyContract(ics721ContractAddr, srcChain.restUrl)

  // Step 4: Verify collection creator to determine origin chain
  const creatorAddr = await fetchCollectionCreatorAddress(contractAddr, srcChain.indexerUrl)

  // Case 1: Origin chain
  if (classId === contractAddr) {
    return {
      class_id: classId,
      class_trace: undefined,
      outgoing_proxy: outgoingProxy,
    }
  }

  // Case 2: Intermediary chain (creator is not the ICS721 contract)
  if (ibcClassId && creatorAddr !== portId.replace("wasm.", "")) {
    const [path, baseClassId] = parseIbcPath(ibcClassId)
    return {
      class_id: contractAddr,
      class_trace: { path, base_class_id: baseClassId },
      outgoing_proxy: outgoingProxy,
    }
  }

  // Case 3: First receiver
  const [path, baseClassId] = parseIbcPath(collectionName)
  return {
    class_id: contractAddr,
    class_trace: { path, base_class_id: baseClassId },
    outgoing_proxy: outgoingProxy,
  }
}
