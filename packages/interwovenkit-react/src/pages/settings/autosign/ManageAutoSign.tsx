import Page from "@/components/Page"
import Status from "@/components/Status"
import { useAutoSignGrantInventory } from "@/pages/autosign/data/queries"
import BrowserConnection from "./BrowserConnection"
import GrantList from "./GrantList"
import styles from "./ManageAutoSign.module.css"

const ManageAutoSign = () => {
  const allGrants = useAutoSignGrantInventory()

  const renderContent = () => {
    const isLoading = allGrants.some((query) => query.isPending)
    const hasError = allGrants.some((query) => query.isError)
    const chainsWithGrants = allGrants
      .filter((query) => query.data && query.data.inventory.length > 0)
      .map((query) => query.data!)

    if (isLoading && chainsWithGrants.length === 0) {
      return <Status>Checking permissions...</Status>
    }

    if (chainsWithGrants.length === 0) {
      return hasError ? (
        <Status error>Unable to check permissions. Try again.</Status>
      ) : (
        <Status>No permissions found</Status>
      )
    }

    return (
      <div className={styles.content}>
        {hasError && <p className={styles.warning}>Some chains could not be checked.</p>}
        {chainsWithGrants.map(({ chainId, inventory }) => (
          <GrantList inventory={inventory} key={chainId} />
        ))}
      </div>
    )
  }

  return (
    <Page title="Manage auto-signing" backButton="/settings">
      <BrowserConnection />
      {renderContent()}
    </Page>
  )
}

export default ManageAutoSign
