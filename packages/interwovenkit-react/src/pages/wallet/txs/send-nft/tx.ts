import type { NormalizedChain } from "@/data/chains"
import type { NormalizedNft } from "../../tabs/nft/queries"
import { fetchOriginTokenIds, handleMinievm } from "./tx.evm"
import { handleMinimove } from "./tx.move"
import { handleMiniwasm } from "./tx.wasm"

const transferHandlers = {
  minimove: handleMinimove,
  minievm: handleMinievm,
  miniwasm: handleMiniwasm,
}

// IBC NFT transfer를 위한 parameter 생성
// VM type별 handler를 dispatch하고 필요 시 EVM-specific token ID mapping 추가
export async function createNftTransferParams({
  nft,
  srcChain,
  intermediaryChain,
}: {
  nft: NormalizedNft
  srcChain: NormalizedChain
  intermediaryChain: NormalizedChain
}) {
  const vmType = srcChain.metadata?.is_l1 ? "minimove" : srcChain.metadata?.minitia?.type

  if (!(vmType === "minimove" || vmType === "minievm" || vmType === "miniwasm")) {
    throw new Error(`Unsupported minitia type: ${vmType}`)
  }

  const transferParams = await transferHandlers[vmType](nft, srcChain, intermediaryChain)

  // EVM의 경우 original token ID로 mapping 필요
  return Object.assign(
    transferParams,
    vmType === "minievm" && {
      token_ids: await fetchOriginTokenIds(
        [nft.token_id],
        transferParams.class_id,
        srcChain.restUrl,
      ),
    },
  )
}
