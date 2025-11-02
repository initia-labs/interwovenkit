import { useAccount } from "wagmi"
import { IconChevronRight, IconExternalLink } from "@initia/icons-react"
import Page from "@/components/Page"
import { useNavigate } from "@/lib/router"
import { PRIVY_APP_ID } from "@/public/data/connectors"
import styles from "./Settings.module.css"

const Settings = () => {
  const navigate = useNavigate()
  const { connector } = useAccount()

  return (
    <Page title="Settings" backButton="/">
      <div className={styles.container}>
        <button className={styles.link} onClick={() => navigate("/settings/revoke")}>
          <div>
            <p className={styles.title}>Manage auto-signing</p>
            <p className={styles.subtitle}>Manage chain auto-signing permissions by apps</p>
          </div>
          <IconChevronRight className={styles.icon} size={16} />
        </button>

        {connector?.id === PRIVY_APP_ID && (
          <button
            className={styles.link}
            onClick={() =>
              window.open(
                "https://privy-export.staging.initia.xyz/",
                "exportPopup",
                "width=600,height=700,scrollbars=yes,resizable=yes",
              )
            }
          >
            <div>
              <p className={styles.title}>Export private key</p>
            </div>
            <IconExternalLink className={styles.icon} size={16} />
          </button>
        )}
      </div>
    </Page>
  )
}

export default Settings
