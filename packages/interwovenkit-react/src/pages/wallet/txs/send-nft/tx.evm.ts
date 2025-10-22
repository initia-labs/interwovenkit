import { Interface } from "ethers"
import ky from "ky"
import { InitiaAddress } from "@initia/utils"
import type { NormalizedChain } from "@/data/chains"
import type { NormalizedNft } from "../../tabs/nft/queries"
import { fetchIbcClassTrace } from "./tx.common"

// ERC721 contract의 name() function을 query하여 collection 이름 조회
// 이름이 "ibc/"로 시작하면 IBC-transferred NFT
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

// IBC로 전송되면서 re-mint된 NFT의 original token ID 조회
// IBC transfer message가 NFT를 올바르게 routing하기 위해 필요
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

// MiniEVM NFT transfer를 위한 class_id와 class_trace 결정
export async function handleMinievm(
  { collection_addr: contractAddr }: NormalizedNft,
  { restUrl }: NormalizedChain,
) {
  const collectionName = await fetchCollectionNameMinievm(contractAddr, restUrl)

  // Case 1: Native EVM NFT (IBC를 통해 전송된 적 없음)
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

  // Case 3: trace 조회 실패 시 fallback (정상적으로는 발생하지 않아야 함)
  return {
    class_id: `evm/${InitiaAddress(contractAddr).rawHex}`,
    class_trace: undefined,
  }
}
