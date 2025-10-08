import type { NftInfo, NormalizedNft } from "./queries"
import { normalizeNft, useNftMetataQuery } from "./queries"

import type { ReactNode } from "react"

interface Props {
  nftInfo: NftInfo
  children: (nft: NormalizedNft) => ReactNode
}

const WithNormalizedNft = ({ nftInfo, children }: Props) => {
  const { data: metadata = {} } = useNftMetataQuery(nftInfo.nft.uri)
  const nft = normalizeNft(nftInfo, metadata)
  return children(nft)
}

export default WithNormalizedNft
