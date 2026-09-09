import { useQueries } from "@tanstack/react-query"
import { useInitiaRegistry } from "@/data/chains"
import { STALE_TIMES } from "@/data/http"
import { fetchAllPages } from "@/data/pagination"
import { useInitiaAddress } from "@/public/data/hooks"
import {
  type FeegrantAllowance,
  getAutoSignRestOptions,
  type Grant,
  normalizeAutoSignGrants,
} from "./fetch"
import { buildAutoSignGrantInventory, type ExpiredLocalGrantIdentity } from "./inventory"
import { listLegacyAutoSignIdentities } from "./storage"
import { autoSignQueryKeys, useAutoSignStatus } from "./validation"
import { getExpectedAddress, useDeriveWallet } from "./wallet"

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

/* Fetch all owner grants. Attribution stays explicit; matching a message type does not prove ownership. */
export function useAllGrants() {
  const initiaAddress = useInitiaAddress()
  const registry = useInitiaRegistry()

  return useQueries({
    queries: registry.map((chain) => ({
      queryKey: autoSignQueryKeys.grants(chain.chainId, initiaAddress, chain.restUrl).queryKey,
      queryFn: async () => {
        const grants = await fetchAllPages<"grants", Grant>(
          `cosmos/authz/v1beta1/grants/granter/${initiaAddress}`,
          getAutoSignRestOptions(chain.restUrl),
          "grants",
        )
        const normalizedGrants = normalizeAutoSignGrants(grants)
        // `issued` enumerates all allowances made by the connected owner, including
        // fee-only orphans. Preserve the authz inventory when this optional endpoint
        // fails and surface its result as unknown rather than pretending it is empty.
        const issuedFeegrants = await fetchAllPages<"allowances", FeegrantAllowance>(
          `cosmos/feegrant/v1beta1/issued/${initiaAddress}`,
          getAutoSignRestOptions(chain.restUrl),
          "allowances",
        )
          .then((allowances) => ({ allowances, availability: "available" as const }))
          .catch(() => ({ allowances: [], availability: "unknown" as const }))

        return {
          chainId: chain.chainId,
          grants: normalizedGrants,
          feegrants: issuedFeegrants.allowances,
          feegrantsAvailability: issuedFeegrants.availability,
        }
      },
      enabled: !!initiaAddress,
      staleTime: STALE_TIMES.SECOND,
      retry: false,
    })),
  })
}

/** Grouped, safe-revoke metadata for management UI. Fee allowances can be supplied as they load. */
export function buildAutoSignGrantInventoryForChain(params: {
  chainId: string
  grants: Grant[]
  initiaAddress?: string
  currentGrantee?: string
  knownGrantees?: Iterable<string>
  feegrants?: Parameters<typeof buildAutoSignGrantInventory>[0]["feegrants"]
  feegrantsAvailability?: Parameters<typeof buildAutoSignGrantInventory>[0]["feegrantsAvailability"]
  expiredLocalIdentity?: ExpiredLocalGrantIdentity
}) {
  const legacyExpectedAddress = params.initiaAddress
    ? (getExpectedAddress(params.initiaAddress, params.chainId) ?? undefined)
    : undefined
  return buildAutoSignGrantInventory({
    chainId: params.chainId,
    grants: params.grants,
    feegrants: params.feegrants,
    feegrantsAvailability: params.feegrantsAvailability,
    // The status resolver supplies the durable random identity. The legacy
    // mirror remains an attribution fallback for deterministic wallets.
    currentGrantee: params.currentGrantee ?? legacyExpectedAddress,
    knownGrantees: params.knownGrantees,
    expiredLocalIdentity: params.expiredLocalIdentity,
  })
}

function getExpiredLocalIdentity(params: {
  status: ReturnType<typeof useAutoSignStatus>["data"]
  chainId: string
}): ExpiredLocalGrantIdentity | undefined {
  const { status, chainId } = params
  if (status?.statusByChain[chainId] !== "expired") return undefined
  const grantee = status.granteeByChain[chainId]
  const expiration = status.expiredAtByChain[chainId]
  if (!grantee || !(expiration instanceof Date) || Number.isNaN(expiration.getTime())) {
    return undefined
  }
  return { grantee, expiration }
}

/** Same query lifecycle as `useAllGrants`, with grouped attribution and revoke metadata. */
export function useAutoSignGrantInventory() {
  const initiaAddress = useInitiaAddress()
  const registry = useInitiaRegistry()
  const queries = useAllGrants()
  const { data: autoSignStatus } = useAutoSignStatus()
  const { getWalletIdentities } = useDeriveWallet()
  const legacyKnownGrantees = initiaAddress
    ? listLegacyAutoSignIdentities(initiaAddress).map((identity) => identity.address)
    : []
  const identityQueries = useQueries({
    queries: registry.map((chain) => ({
      queryKey: autoSignQueryKeys.identities(chain.chain_id, initiaAddress).queryKey,
      queryFn: () => getWalletIdentities(chain.chain_id),
      enabled: !!initiaAddress,
      staleTime: STALE_TIMES.SECOND,
      retry: false,
    })),
  })
  const knownGranteesByChain = new Map(
    registry.map((chain, index) => [
      chain.chain_id,
      (identityQueries[index]?.data ?? []).map((identity) => identity.address),
    ]),
  )

  return queries.map((query) =>
    query.data
      ? {
          ...query,
          data: {
            ...query.data,
            inventory: buildAutoSignGrantInventoryForChain({
              ...query.data,
              initiaAddress,
              currentGrantee: autoSignStatus?.granteeByChain[query.data.chainId],
              knownGrantees: [
                ...legacyKnownGrantees,
                ...(knownGranteesByChain.get(query.data.chainId) ?? []),
              ],
              feegrants: query.data.feegrants,
              feegrantsAvailability: query.data.feegrantsAvailability,
              expiredLocalIdentity: getExpiredLocalIdentity({
                status: autoSignStatus,
                chainId: query.data.chainId,
              }),
            }),
          },
        }
      : query,
  )
}
