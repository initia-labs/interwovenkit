import { useState } from "react"
import { IconWarningFilled } from "@initia/icons-react"
import { useInitiaRegistry } from "@/data/chains"
import styles from "./WebsiteWarning.module.css"

const WebsiteWarning = () => {
  const [ignored, setIgnored] = useState(false)
  const chains = useInitiaRegistry()
  const trustedWebsites = chains
    .map(({ website }) => {
      try {
        const url = new URL(website || "")
        return url.host.replace("www.", "")
      } catch {
        return null
      }
    })
    .filter((host): host is string => !!host)

  const isTrusted = trustedWebsites.some(
    (host) => window.location.host === host || window.location.host.endsWith(`.${host}`),
  )

  if (isTrusted || ignored) return null

  return (
    <div className={styles.warning}>
      <IconWarningFilled className={styles.icon} size={12} />
      <p>You are on an unverified website.</p>
      <button onClick={() => setIgnored(true)}>Ignore</button>
    </div>
  )
}

export default WebsiteWarning
