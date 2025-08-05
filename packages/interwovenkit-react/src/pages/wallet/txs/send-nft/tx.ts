import ky from "ky"
import { Interface } from "ethers"
import { toBytes, utf8ToBytes } from "@noble/hashes/utils"
import { toBase64 } from "@cosmjs/encoding"
import { InitiaAddress, createObjectAddress } from "@initia/utils"
import type { NormalizedChain } from "@/data/chains"
import type { NormalizedCollection, NormalizedNft } from "../../tabs/nft/queries"

async function handleMinimove(
  { object_addr: objectAddr }: NormalizedCollection,
  { restUrl }: NormalizedChain,
) {
  const name = await fetchCollectionNameMinimove(objectAddr, restUrl)

  // Non-IBC: padded move class ID
  if (!name.startsWith("ibc/")) {
    return {
      class_id: `move/${objectAddr.replace("0x", "").padStart(64, "0")}`,
      class_trace: null,
    }
  }

  // Root creator: return IBC class ID and trace
  if (InitiaAddress.equals(createObjectAddress("0x1", name), objectAddr)) {
    return {
      class_id: name,
      class_trace: await fetchIbcClassTrace(name, restUrl),
    }
  }

  // Default: padded move class ID with trace
  return {
    class_id: `move/${objectAddr.replace("0x", "").padStart(64, "0")}`,
    class_trace: await fetchIbcClassTrace(name, restUrl),
  }
}

async function fetchCollectionNameMinimove(objectAddr: string, restUrl: string) {
  const { data } = await ky
    .create({ prefixUrl: restUrl })
    .post("initia/move/v1/view/json", {
      json: {
        address: "0x1",
        module_name: "collection",
        function_name: "name",
        type_args: ["0x1::collection::Collection"],
        args: [JSON.stringify(objectAddr)],
      },
    })
    .json<{ data: string }>()
  return JSON.parse(data)
}

async function handleMinievm(
  { object_addr: objectAddr }: NormalizedCollection,
  { restUrl }: NormalizedChain,
) {
  const name = await fetchCollectionNameMinievm(objectAddr, restUrl)

  // Non-IBC: hex-based EVM class ID
  if (!name.startsWith("ibc/")) {
    return {
      class_id: `evm/${InitiaAddress(objectAddr).rawHex}`,
      class_trace: null,
    }
  }

  // Fetch IBC trace
  const classTrace = await fetchIbcClassTrace(name, restUrl)

  if (classTrace) {
    return {
      class_id: name,
      class_trace: classTrace,
    }
  }

  return {
    class_id: `evm/${InitiaAddress(objectAddr).rawHex}`,
    class_trace: null,
  }
}

async function fetchCollectionNameMinievm(objectAddr: string, restUrl: string) {
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
        contract_addr: InitiaAddress(objectAddr).hex,
        input: abi.encodeFunctionData("name"),
      },
    })
    .json<{ response: string }>()

  return abi.decodeFunctionResult("name", response)[0]
}

async function handleMiniwasm(
  { creator_addr: creatorAddr, object_addr: objectAddr }: NormalizedCollection,
  srcChain: NormalizedChain,
  intermediaryChain: NormalizedChain,
) {
  const name = await fetchCollectionNameMiniwasm(objectAddr, srcChain.restUrl)

  // Find IBC channel to intermediary
  const channel = srcChain.metadata?.ibc_channels?.find(
    ({ chain_id, version }) =>
      chain_id === intermediaryChain.chain_id && version.includes("ics721-1"),
  )
  if (!channel) throw new Error("Channel not found")

  // Query contract for class ID
  const portId = channel.port_id
  const contract = portId.split(".")[1]
  const queryData = toBase64(toBytes(JSON.stringify({ class_id: { contract: objectAddr } })))
  const url = `cosmwasm/wasm/v1/contract/${contract}/smart/${queryData}`
  const { data } = await ky
    .create({ prefixUrl: srcChain.restUrl })
    .get(url)
    .json<{ data: string | null }>()
  const class_id = data ?? objectAddr

  // If not original creator: no trace
  if (data && creatorAddr !== portId.replace("wasm.", "")) {
    const [path, baseClassId] = splitIbcChannel(data)

    return {
      class_id: objectAddr,
      class_trace: { path, base_class_id: baseClassId },
    }
  }

  // Split channel path for trace
  const [path, baseClassId] = splitIbcChannel(name)
  return {
    class_id,
    class_trace: { path, base_class_id: baseClassId },
  }
}

async function fetchCollectionNameMiniwasm(objectAddr: string, restUrl: string) {
  const queryData = toBase64(utf8ToBytes(JSON.stringify({ contract_info: {} })))
  const { name } = await ky
    .create({ prefixUrl: restUrl })
    .get(`cosmwasm/wasm/v1/contract/${objectAddr}/smart/${queryData}`)
    .json<{ name: string }>()
  return name
}

const transferHandlers = {
  minimove: handleMinimove,
  minievm: handleMinievm,
  miniwasm: handleMiniwasm,
}

export async function createNftTransferParams({
  collection,
  nft,
  srcChain,
  intermediaryChain,
}: {
  collection: NormalizedCollection
  nft: NormalizedNft
  srcChain: NormalizedChain
  intermediaryChain: NormalizedChain
}) {
  const minitiaType = srcChain.metadata?.is_l1 ? "minimove" : srcChain.metadata?.minitia?.type
  if (!(minitiaType === "minimove" || minitiaType === "minievm" || minitiaType === "miniwasm")) {
    throw new Error(`Unsupported minitia type: ${minitiaType}`)
  }

  const nftTransferParams = await transferHandlers[minitiaType](
    collection,
    srcChain,
    intermediaryChain,
  )

  return Object.assign(
    nftTransferParams,
    minitiaType === "minievm" && {
      token_ids: await fetchOriginTokenIds(
        [nft.token_id],
        nftTransferParams.class_id,
        srcChain.restUrl,
      ),
    },
  )
}

async function fetchIbcClassTrace(name: string, restUrl: string) {
  const hash = name.replace("ibc/", "")
  const { class_trace } = await ky
    .create({ prefixUrl: restUrl })
    .get(`ibc/apps/nft_transfer/v1/class_traces/${hash}`)
    .json<{ class_trace: { path: string; base_class_id: string } }>()
  return class_trace
}

async function fetchOriginTokenIds(tokenIds: string[], classId: string, restUrl: string) {
  const { token_infos } = await ky
    .create({ prefixUrl: restUrl })
    .get(`minievm/evm/v1/erc721/origin_token_infos/${classId}`, {
      searchParams: { token_ids: tokenIds.join(",") },
    })
    .json<{ token_infos: { token_origin_id: string; token_uri: string }[] }>()
  return token_infos.map(({ token_origin_id }) => token_origin_id)
}

export function splitIbcChannel(input: string) {
  const regex = /^(.*channel-\d+)\/(.*)$/
  const match = input.match(regex)
  if (!match) throw new Error("Pattern `channel-{number}/` not found.")
  const [, before, after] = match
  return [before, after]
}
