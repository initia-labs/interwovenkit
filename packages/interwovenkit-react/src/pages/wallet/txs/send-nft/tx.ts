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

// Generate parameters for IBC NFT transfer
// Dispatch handler by VM type and add EVM-specific token ID mapping if necessary
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

  // For EVM, mapping to original token ID is required
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
