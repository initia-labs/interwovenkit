import { useMemo } from "react"
import Page from "@/components/Page"
import type { AutoSignDomainPermission } from "@/pages/autosign/data/queries"
import { useAllGrants, useGranteeAddressDomain } from "@/pages/autosign/data/queries"
import RevokeGrantsItem from "./RevokeGrantsItem"
import styles from "./ManageAutoSign.module.css"

const ManageAutoSign = () => {
  const allGrantsQueries = useAllGrants()
  const { data: permissions, isLoading: isPermissionsLoading } = useGranteeAddressDomain()

  // Check if any query is loading
  const isLoading = allGrantsQueries.some((query) => query.isLoading) || isPermissionsLoading
  const isFetching = allGrantsQueries.some((query) => query.isFetching)

  // Group grants by domain
  const groupedGrants = useMemo(() => {
    type GrantInfo = { grantee: string; expiration: string; chainId: string }
    type GrantWithDomainInfo = GrantInfo & { permission?: AutoSignDomainPermission }

    const grantsGroupedByDomain = new Map<string, GrantWithDomainInfo[]>()
    const grantsWithoutDomainMapping: GrantInfo[] = []
    const processedGrantKeys = new Set<string>()

    // Process all grants from all chains
    allGrantsQueries
      .filter((query) => query.isSuccess && query.data)
      .forEach((query) => {
        const chainId = query.data!.chainId

        query.data!.grants.forEach((grant) => {
          // Skip duplicates based on grantee+chainId
          const key = `${grant.grantee}-${chainId}`
          if (processedGrantKeys.has(key)) return
          processedGrantKeys.add(key)

          const grantData = {
            grantee: grant.grantee,
            expiration: grant.expiration,
            chainId,
          }

          // Find the permission where granterAddress matches the grantee (backend naming issue)
          const permission = permissions?.find(
            ({ granteeAddress }) => granteeAddress === grant.grantee,
          )

          if (permission) {
            const domain = permission.domainAddress
            if (!grantsGroupedByDomain.has(domain)) {
              grantsGroupedByDomain.set(domain, [])
            }
            grantsGroupedByDomain.get(domain)!.push({ ...grantData, permission })
          } else {
            grantsWithoutDomainMapping.push(grantData)
          }
        })
      })

    return { grantsGroupedByDomain, grantsWithoutDomainMapping }
  }, [allGrantsQueries, permissions])

  const renderGranteeDomain = ({ domain, icon }: { domain: string; icon?: string }) => {
    if (!domain) return null
    const { hostname } = new URL(domain)
    return (
      <div className={styles.domainHeader}>
        {icon && <img src={icon} alt={domain} className={styles.domainIcon} />}
        <span className={styles.domainName}>{hostname}</span>
      </div>
    )
  }

  // Render content based on state
  const renderGrantsList = () => {
    if (isLoading || isFetching) {
      return <p className={styles.empty}>Loading...</p>
    }

    if (
      groupedGrants.grantsGroupedByDomain.size === 0 &&
      groupedGrants.grantsWithoutDomainMapping.length === 0
    ) {
      return <p className={styles.empty}>Nothing found</p>
    }

    return (
      <div className={styles.list}>
        {/* Render grants grouped by domain */}
        {Array.from(groupedGrants.grantsGroupedByDomain.entries()).map(([domain, grants]) => (
          <div key={domain} className={styles.domainGroup}>
            {/* Show domain header once for the group */}
            {renderGranteeDomain({ domain, icon: grants[0]?.permission?.icon?.icon })}
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
        {groupedGrants.grantsWithoutDomainMapping.length > 0 && (
          <div className={styles.domainGroup}>
            <div className={styles.domainHeader}>
              <span className={styles.domainName}>Unknown</span>
            </div>
            {groupedGrants.grantsWithoutDomainMapping.map((grant) => (
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

  return (
    <Page title="Manage auto-signing" backButton="/settings">
      {renderGrantsList()}
    </Page>
  )
}

export default ManageAutoSign
