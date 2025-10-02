import Page from "@/components/Page"
import { useAllGrants } from "@/pages/ghost-wallet/queries"
import RevokeGrantsItem from "./RevokeGrantsItem"
import styles from "./RevokeGrantsItem.module.css"

const RevokeGrantsPage = () => {
  const { data: grants, isLoading } = useAllGrants()

  const groupedGrants =
    grants?.grants.reduce(
      (acc, grant) => {
        const existingGrantee = acc.find((g) => g.grantee === grant.grantee)

        if (existingGrantee) {
          if (grant.expiration) {
            const grantExpiration = new Date(grant.expiration).getTime()
            const currentExpiration = existingGrantee.expiration
              ? new Date(existingGrantee.expiration).getTime()
              : 0
            if (grantExpiration > currentExpiration) {
              existingGrantee.expiration = grant.expiration
            }
          }
        } else {
          acc.push({
            grantee: grant.grantee,
            expiration: grant.expiration,
          })
        }

        return acc
      },
      [] as { grantee: string; expiration: string }[],
    ) || []

  return (
    <Page title="Manage auto-signing">
      {isLoading ? (
        <p className={styles.empty}>Loading...</p>
      ) : groupedGrants.length > 0 ? (
        groupedGrants.map((grant) => (
          <RevokeGrantsItem
            key={grant.grantee}
            grantee={grant.grantee}
            expiration={grant.expiration}
          />
        ))
      ) : (
        <p className={styles.empty}>Nothing found</p>
      )}
    </Page>
  )
}

export default RevokeGrantsPage
