import ky from "ky"
import { createObjectAddress, InitiaAddress } from "@initia/utils"
import type { NormalizedChain } from "@/data/chains"
import type { NormalizedNft } from "../../tabs/nft/queries"
import { fetchIbcClassTrace } from "./tx.common"

// Move module의 collection::name view function을 query하여 collection 이름 조회
async function fetchCollectionNameMinimove(collectionAddr: string, restUrl: string) {
  const { data } = await ky
    .create({ prefixUrl: restUrl })
    .post("initia/move/v1/view/json", {
      json: {
        address: "0x1",
        module_name: "collection",
        function_name: "name",
        type_args: ["0x1::collection::Collection"],
        args: [JSON.stringify(collectionAddr)],
      },
    })
    .json<{ data: string }>()

  return JSON.parse(data)
}

// MiniMove NFT transfer를 위한 class_id와 class_trace 결정
export async function handleMinimove(
  { object_addr: objectAddr, collection_addr: collectionAddr }: NormalizedNft,
  { restUrl }: NormalizedChain,
) {
  const collectionName = await fetchCollectionNameMinimove(collectionAddr, restUrl)

  // Case 1: Native Move NFT (IBC를 통해 전송된 적 없음)
  if (!collectionName.startsWith("ibc/")) {
    return {
      class_id: `move/${collectionAddr.replace("0x", "").padStart(64, "0")}`,
      class_trace: null,
    }
  }

  // Case 2: 이 chain이 root creator (address 0x1이 IBC name으로 생성한 object address와 일치)
  if (InitiaAddress.equals(createObjectAddress("0x1", collectionName), objectAddr)) {
    return {
      class_id: collectionName,
      class_trace: await fetchIbcClassTrace(collectionName, restUrl),
    }
  }

  // Case 3: 이 chain이 intermediary (NFT가 local Move object address로 wrapping됨)
  return {
    class_id: `move/${objectAddr.replace("0x", "").padStart(64, "0")}`,
    class_trace: await fetchIbcClassTrace(collectionName, restUrl),
  }
}
