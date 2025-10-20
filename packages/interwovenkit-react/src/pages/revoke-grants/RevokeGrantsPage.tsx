import { useMemo } from "react"
import Page from "@/components/Page"
import { useAllGrants, useGranteeAddressDomain } from "@/pages/ghost-wallet/queries"
import GranteeDomain from "./GranteeDomain"
import RevokeGrantsItem from "./RevokeGrantsItem"
import styles from "./RevokeGrantsItem.module.css"

const RevokeGrantsPage = () => {
  const allGrantsQueries = useAllGrants()
  const { data: permissions, isLoading: isPermissionsLoading } = useGranteeAddressDomain()

  // Check if any query is loading
  const isLoading = allGrantsQueries.some((query) => query.isLoading) || isPermissionsLoading
  const isFetching = allGrantsQueries.some((query) => query.isFetching)

  // Group grants by domain
  const groupedGrants = useMemo(() => {
    type Grant = { grantee: string; expiration: string; chainId: string }
    type GrantWithPermission = Grant & {
      permission?: {
        domainAddress: string
        metadata?: { icon: string }
        granterAddress: string
        address: string
      }
    }

    const withDomain = new Map<string, GrantWithPermission[]>()
    const unknown: Grant[] = []
    const seen = new Set<string>()

    // Process all grants from all chains
    allGrantsQueries
      .filter((query) => query.isSuccess && query.data)
      .forEach((query) => {
        const chainId = query.data!.chainId

        query.data!.grants.forEach((grant) => {
          // Skip duplicates based on grantee+chainId
          const key = `${grant.grantee}-${chainId}`
          if (seen.has(key)) return
          seen.add(key)

          const grantData = {
            grantee: grant.grantee,
            expiration: grant.expiration,
            chainId,
          }

          // Find the permission where granterAddress matches the grantee (backend naming issue)
          const permission = permissions?.find((p) => p.granterAddress === grant.grantee)

          if (permission) {
            const domain = permission.domainAddress
            if (!withDomain.has(domain)) {
              withDomain.set(domain, [])
            }
            withDomain.get(domain)!.push({ ...grantData, permission })
          } else {
            unknown.push(grantData)
          }
        })
      })

    return { withDomain, unknown }
  }, [allGrantsQueries, permissions])

  // Render content based on state
  const renderContent = () => {
    if (isLoading || isFetching) {
      return <p className={styles.empty}>Loading...</p>
    }

    if (groupedGrants.withDomain.size === 0 && groupedGrants.unknown.length === 0) {
      return <p className={styles.empty}>Nothing found</p>
    }

    return (
      <div className={styles.list}>
        {/* Render grants grouped by domain */}
        {Array.from(groupedGrants.withDomain.entries()).map(([domain, grants]) => (
          <div key={domain} className={styles.domainGroup}>
            {/* Show domain header once for the group */}
            <GranteeDomain domainName={domain} domainIcon={grants[0]?.permission?.metadata?.icon} />
            {/* Render all grants for this domain */}
            {grants.map((grant) => (
              <RevokeGrantsItem
                key={`${grant.grantee}-${grant.chainId}`}
                grantee={grant.grantee}
                expiration={grant.expiration}
                chainId={grant.chainId}
              />
            ))}
          </div>
        ))}

        {/* Render unknown grants at the bottom */}
        {groupedGrants.unknown.length > 0 && (
          <div className={styles.domainGroup}>
            <div className={styles.domainHeader}>
              <span className={styles.domainName}>Unknown</span>
            </div>
            {groupedGrants.unknown.map((grant) => (
              <RevokeGrantsItem
                key={`${grant.grantee}-${grant.chainId}`}
                grantee={grant.grantee}
                expiration={grant.expiration}
                chainId={grant.chainId}
              />
            ))}
          </div>
        )}
      </div>
    )
  }

  return <Page title="Manage auto-signing">{renderContent()}</Page>
}

export default RevokeGrantsPage
