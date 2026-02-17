import { useQueries } from "@tanstack/react-query"
import { useInitiaRegistry } from "@/data/chains"
import { STALE_TIMES } from "@/data/http"
import { fetchAllPages } from "@/data/pagination"
import { useInitiaAddress } from "@/public/data/hooks"
import { type Grant, normalizeAutoSignGrants } from "./fetch"
import { autoSignQueryKeys } from "./validation"
import { getExpectedAddress } from "./wallet"

export type { Grant } from "./fetch"

export function filterAutoSignGrantsByExpectedAddress(
  grants: Grant[],
  expectedAddress: string | null | undefined,
): Grant[] {
  if (expectedAddress == null) {
    return grants
  }

  return grants.filter((grant) => grant.grantee === expectedAddress)
}

/* Fetch authz grants from all chains in the registry, filtered to only show this app's grants */
export function useAllGrants() {
  const initiaAddress = useInitiaAddress()
  const registry = useInitiaRegistry()

  return useQueries({
    queries: registry.map((chain) => ({
      queryKey: autoSignQueryKeys.grants(chain.chainId, initiaAddress).queryKey,
      queryFn: async () => {
        const grants = await fetchAllPages<"grants", Grant>(
          `cosmos/authz/v1beta1/grants/granter/${initiaAddress}`,
          { prefixUrl: chain.restUrl },
          "grants",
        )
        const normalizedGrants = normalizeAutoSignGrants(grants)

        const expectedAddress = initiaAddress
          ? getExpectedAddress(initiaAddress, chain.chainId)
          : null

        const filteredGrants = filterAutoSignGrantsByExpectedAddress(
          normalizedGrants,
          expectedAddress,
        )

        return { chainId: chain.chainId, grants: filteredGrants }
      },
      enabled: !!initiaAddress,
      staleTime: STALE_TIMES.SECOND,
      retry: false,
    })),
  })
}
