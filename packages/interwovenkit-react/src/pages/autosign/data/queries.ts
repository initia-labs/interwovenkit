import ky from "ky"
import { useQueries } from "@tanstack/react-query"
import { useInitiaRegistry } from "@/data/chains"
import { STALE_TIMES } from "@/data/http"
import { useInitiaAddress } from "@/public/data/hooks"
import type { GrantsResponse } from "./fetch"
import { autoSignQueryKeys } from "./validation"

export type { Grant } from "./fetch"

/* Fetch authz grants from all chains in the registry for the current user */
export function useAllGrants() {
  const initiaAddress = useInitiaAddress()
  const registry = useInitiaRegistry()

  return useQueries({
    queries: registry.map((chain) => ({
      queryKey: autoSignQueryKeys.allGrants(chain.chainId, initiaAddress).queryKey,
      queryFn: async () => {
        const { grants } = await ky
          .create({ prefixUrl: chain.restUrl })
          .get(`cosmos/authz/v1beta1/grants/granter/${initiaAddress}`)
          .json<GrantsResponse>()
        return { chainId: chain.chainId, grants }
      },
      enabled: !!initiaAddress,
      staleTime: STALE_TIMES.SECOND,
      retry: false,
    })),
  })
}
