import Page from "@/components/Page"
import styles from "./SettingsPage.module.css"
import { useNavigate } from "@/lib/router"
import { IconChevronRight } from "@initia/icons-react"

const SettingsPage = () => {
  const navigate = useNavigate()

  return (
    <Page title="Settings">
      <div className={styles.container}>
        <button className={styles.link} onClick={() => navigate("/settings/revoke")}>
          <p className={styles.title}>Manage auto-signing</p>
          <p className={styles.subtitle}>Manage which websites have auto-signing permissions</p>
          <IconChevronRight className={styles.icon} size={16} />
        </button>

        <button
          className={styles.link}
          onClick={() =>
            window.open(
              "https://export.initia.xyz",
              "exportPopup",
              "width=600,height=700,scrollbars=yes,resizable=yes",
            )
          }
        >
          <p className={styles.title}>Export private key</p>
          <IconChevronRight className={styles.icon} size={16} />
        </button>
      </div>
    </Page>
  )
}

export default SettingsPage
