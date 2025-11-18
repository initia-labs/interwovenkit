import { Interface } from "ethers"
import ky from "ky"
import { InitiaAddress } from "@initia/utils"
import type { NormalizedChain } from "@/data/chains"
import type { NormalizedNft } from "../../tabs/nft/queries"
import { fetchIbcClassTrace } from "./tx.common"

// Query the name() function of ERC721 contract to retrieve collection name
// If the name starts with "ibc/", it's an IBC-transferred NFT
async function fetchCollectionNameMinievm(contractAddr: string, restUrl: string) {
  const abi = new Interface([
    {
      inputs: [],
      name: "name",
      outputs: [{ internalType: "string", name: "", type: "string" }],
      stateMutability: "view",
      type: "function",
    },
  ])

  const { response } = await ky
    .create({ prefixUrl: restUrl })
    .post("minievm/evm/v1/call", {
      json: {
        sender: InitiaAddress("0x1").bech32,
        contract_addr: InitiaAddress(contractAddr).hex,
        input: abi.encodeFunctionData("name"),
      },
    })
    .json<{ response: string }>()

  return abi.decodeFunctionResult("name", response)[0]
}

// Fetch the original token ID of NFTs that were re-minted during IBC transfer
// Required for IBC transfer messages to correctly route the NFT
export async function fetchOriginTokenIds(tokenIds: string[], classId: string, restUrl: string) {
  if (classId.startsWith("evm/")) {
    return tokenIds
  }

  const { token_infos } = await ky
    .create({ prefixUrl: restUrl })
    .get(`minievm/evm/v1/erc721/origin_token_infos/${classId}`, {
      searchParams: { token_ids: tokenIds.join(",") },
    })
    .json<{ token_infos: { token_origin_id: string; token_uri: string }[] }>()

  return token_infos.map(({ token_origin_id }) => token_origin_id)
}

// Determine class_id and class_trace for MiniEVM NFT transfer
export async function handleMinievm(
  { collection_addr: contractAddr }: NormalizedNft,
  { restUrl }: NormalizedChain,
) {
  const collectionName = await fetchCollectionNameMinievm(contractAddr, restUrl)

  // Case 1: Native EVM NFT (never transferred via IBC)
  if (!collectionName.startsWith("ibc/")) {
    return {
      class_id: `evm/${InitiaAddress(contractAddr).rawHex}`,
      class_trace: undefined,
    }
  }

  // Case 2: IBC-transferred NFT
  const classTrace = await fetchIbcClassTrace(collectionName, restUrl)

  if (classTrace) {
    return {
      class_id: collectionName,
      class_trace: classTrace,
    }
  }

  // Case 3: Fallback when trace query fails (should not happen under normal circumstances)
  return {
    class_id: `evm/${InitiaAddress(contractAddr).rawHex}`,
    class_trace: undefined,
  }
}
