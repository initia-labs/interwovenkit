import { useMemo } from "react"
import Page from "@/components/Page"
import { useAllGrants } from "@/pages/ghost-wallet/queries"
import RevokeGrantsItem from "./RevokeGrantsItem"
import styles from "./RevokeGrantsItem.module.css"

const RevokeGrantsPage = () => {
  const { data: grants, isLoading, isFetching } = useAllGrants()

  // Use functional approach to get unique grants by grantee
  const uniqueGrants = useMemo(() => {
    if (!grants?.grants) return []

    // Create a map of unique grantees with their first occurrence's expiration
    const uniqueGrantsMap = grants.grants.reduce((acc, grant) => {
      if (!acc.has(grant.grantee)) {
        acc.set(grant.grantee, grant.expiration)
      }
      return acc
    }, new Map<string, string>())

    // Convert to array format
    return Array.from(uniqueGrantsMap, ([grantee, expiration]) => ({
      grantee,
      expiration,
    }))
  }, [grants])

  // Render content based on state
  const renderContent = () => {
    if (isLoading || isFetching) {
      return <p className={styles.empty}>Loading...</p>
    }

    if (uniqueGrants.length === 0) {
      return <p className={styles.empty}>Nothing found</p>
    }

    return uniqueGrants.map((grant) => (
      <RevokeGrantsItem key={grant.grantee} grantee={grant.grantee} expiration={grant.expiration} />
    ))
  }

  return <Page title="Manage auto-signing">{renderContent()}</Page>
}

export default RevokeGrantsPage
