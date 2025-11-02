import { useAccount } from "wagmi"
import { IconChevronRight, IconExternalLink } from "@initia/icons-react"
import Page from "@/components/Page"
import { useNavigate } from "@/lib/router"
import { PRIVY_APP_ID } from "@/public/data/connectors"
import styles from "./Settings.module.css"

const PRIVY_EXPORT_URL = "https://export.initia.xyz/"

const Settings = () => {
  const navigate = useNavigate()
  const { connector } = useAccount()

  return (
    <Page title="Settings" backButton="/">
      <div className={styles.container}>
        <button className={styles.link} onClick={() => navigate("/settings/autosign")}>
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
                PRIVY_EXPORT_URL,
                "_blank",
                "width=600,height=768,scrollbars=yes,resizable=yes",
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
