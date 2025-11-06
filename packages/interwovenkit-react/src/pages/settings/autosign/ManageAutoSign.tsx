import Page from "@/components/Page"
import Status from "@/components/Status"
import { useAllGrants } from "@/pages/autosign/data/queries"
import GrantList from "./GrantList"
import styles from "./ManageAutoSign.module.css"

const ManageAutoSign = () => {
  const allGrants = useAllGrants()

  const renderContent = () => {
    const chainsWithGrants = allGrants
      .filter((query) => query.data && query.data.grants.length > 0)
      .map((query) => query.data!)

    if (chainsWithGrants.length === 0) {
      return <Status>No permissions found</Status>
    }

    return (
      <div className={styles.content}>
        {chainsWithGrants.map(({ chainId, grants }) => (
          <GrantList chainId={chainId} grants={grants} key={chainId} />
        ))}
      </div>
    )
  }

  return (
    <Page title="Manage auto-signing" backButton="/settings">
      {renderContent()}
    </Page>
  )
}

export default ManageAutoSign
