import { useAccount } from "wagmi"
import { Separator } from "@base-ui-components/react"
import Page from "@/components/Page"
import { useNavigate } from "@/lib/router"
import { PRIVY_APP_ID } from "@/public/data/connectors"
import Version from "../wallet/components/Version"
import ExportPrivateKey from "./ExportPrivateKey"
import SettingItem from "./SettingItem"
import styles from "./Settings.module.css"

const Settings = () => {
  const navigate = useNavigate()
  const { connector } = useAccount()

  return (
    <Page title="Settings" backButton="/">
      <div className={styles.container}>
        <SettingItem
          title="Manage auto-signing"
          subtitle="Manage chain auto-signing permissions by apps"
          onClick={() => navigate("/settings/autosign")}
        />
        {connector?.id === PRIVY_APP_ID && <ExportPrivateKey />}
        <Separator className={styles.separator} />
        <Version />
      </div>
    </Page>
  )
}

export default Settings
