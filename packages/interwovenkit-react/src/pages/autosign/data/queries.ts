import ky from "ky"
import { useQueries } from "@tanstack/react-query"
import { useInitiaRegistry } from "@/data/chains"
import { STALE_TIMES } from "@/data/http"
import { useInitiaAddress } from "@/public/data/hooks"
import type { GrantsResponse } from "./fetch"
import { autoSignQueryKeys } from "./validation"
import { getExpectedAddress } from "./wallet"

export type { Grant } from "./fetch"

/* Fetch authz grants from all chains in the registry, filtered to only show this app's grants */
export function useAllGrants() {
  const initiaAddress = useInitiaAddress()
  const registry = useInitiaRegistry()

  return useQueries({
    queries: registry.map((chain) => ({
      queryKey: autoSignQueryKeys.grants(chain.chainId, initiaAddress).queryKey,
      queryFn: async () => {
        const { grants } = await ky
          .create({ prefixUrl: chain.restUrl })
          .get(`cosmos/authz/v1beta1/grants/granter/${initiaAddress}`)
          .json<GrantsResponse>()

        const expectedAddress = initiaAddress
          ? getExpectedAddress(initiaAddress, chain.chainId)
          : null

        const filteredGrants = expectedAddress
          ? grants.filter((grant) => grant.grantee === expectedAddress)
          : []

        return { chainId: chain.chainId, grants: filteredGrants }
      },
      enabled: !!initiaAddress,
      staleTime: STALE_TIMES.SECOND,
      retry: false,
    })),
  })
}
