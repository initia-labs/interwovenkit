import ky from "ky"
import type { ReactNode } from "react"
import { useSuspenseQuery } from "@tanstack/react-query"
import { STALE_TIMES } from "@/data/http"
import type { NormalizedChain } from "@/data/chains"
import { assetQueryKeys } from "@/data/assets"

interface Props {
  metadata: string
  chain: NormalizedChain
  children: (denom: string) => ReactNode
}

const WithDenom = ({ metadata, chain, children }: Props) => {
  const { restUrl } = chain

  const { data: denom } = useSuspenseQuery({
    queryKey: assetQueryKeys.denom(restUrl, metadata).queryKey,
    queryFn: () =>
      ky
        .create({ prefixUrl: restUrl })
        .get("initia/move/v1/denom", { searchParams: { metadata } })
        .json<{ denom: string }>(),
    select: ({ denom }) => denom,
    staleTime: STALE_TIMES.INFINITY,
  })

  return children(denom)
}

export default WithDenom
