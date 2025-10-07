import Page from "@/components/Page"
import { useAllGrants } from "@/pages/ghost-wallet/queries"
import RevokeGrantsItem from "./RevokeGrantsItem"
import styles from "./RevokeGrantsItem.module.css"

const RevokeGrantsPage = () => {
  const { data: grants, isLoading } = useAllGrants()

  // Get unique grants by grantee (using Map to deduplicate)
  const uniqueGrantees = new Map<string, string>()
  grants?.grants.forEach((grant) => {
    if (!uniqueGrantees.has(grant.grantee)) {
      uniqueGrantees.set(grant.grantee, grant.expiration)
    }
  })

  const groupedGrants = Array.from(uniqueGrantees, ([grantee, expiration]) => ({
    grantee,
    expiration,
  }))

  // Early return for loading state
  if (isLoading) {
    return (
      <Page title="Manage auto-signing">
        <p className={styles.empty}>Loading...</p>
      </Page>
    )
  }

  // Early return for empty state
  if (groupedGrants.length === 0) {
    return (
      <Page title="Manage auto-signing">
        <p className={styles.empty}>Nothing found</p>
      </Page>
    )
  }

  // Main content
  return (
    <Page title="Manage auto-signing">
      {groupedGrants.map((grant) => (
        <RevokeGrantsItem
          key={grant.grantee}
          grantee={grant.grantee}
          expiration={grant.expiration}
        />
      ))}
    </Page>
  )
}

export default RevokeGrantsPage
