import ky from "ky"
import { createObjectAddress, InitiaAddress } from "@initia/utils"
import type { NormalizedChain } from "@/data/chains"
import type { NormalizedNft } from "../../tabs/nft/queries"
import { fetchIbcClassTrace } from "./tx.common"

// Query the collection::name view function of Move module to retrieve collection name
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

// Determine class_id and class_trace for MiniMove NFT transfer
export async function handleMinimove(
  { object_addr: objectAddr, collection_addr: collectionAddr }: NormalizedNft,
  { restUrl }: NormalizedChain,
) {
  const collectionName = await fetchCollectionNameMinimove(collectionAddr, restUrl)

  // Case 1: Native Move NFT (never transferred via IBC)
  if (!collectionName.startsWith("ibc/")) {
    return {
      class_id: `move/${collectionAddr.replace("0x", "").padStart(64, "0")}`,
      class_trace: undefined,
    }
  }

  // Case 2: This chain is the root creator (matches object address created by address 0x1 with IBC name)
  if (InitiaAddress.equals(createObjectAddress("0x1", collectionName), collectionAddr)) {
    return {
      class_id: collectionName,
      class_trace: await fetchIbcClassTrace(collectionName, restUrl),
    }
  }

  // Case 3: This chain is an intermediary (NFT is wrapped with local Move object address)
  return {
    class_id: `move/${objectAddr.replace("0x", "").padStart(64, "0")}`,
    class_trace: await fetchIbcClassTrace(collectionName, restUrl),
  }
}
