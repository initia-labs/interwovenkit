import { useAccount } from "wagmi"
import { IconChevronRight } from "@initia/icons-react"
import Page from "@/components/Page"
import { useNavigate } from "@/lib/router"
import styles from "./SettingsPage.module.css"

const SettingsPage = () => {
  const navigate = useNavigate()
  const { connector } = useAccount()

  return (
    <Page title="Settings">
      <div className={styles.container}>
        <button className={styles.link} onClick={() => navigate("/settings/revoke")}>
          <div>
            <p className={styles.title}>Manage auto-signing</p>
            <p className={styles.subtitle}>Manage which websites have auto-signing permissions</p>
          </div>
          <IconChevronRight className={styles.icon} size={16} />
        </button>

        {connector?.id === "io.privy.wallet" && (
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
            <IconChevronRight className={styles.icon} size={16} />
          </button>
        )}
      </div>
    </Page>
  )
}

export default SettingsPage
