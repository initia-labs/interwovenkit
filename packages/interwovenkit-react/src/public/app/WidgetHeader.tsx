import { useEffect } from "react"
import clsx from "clsx"
import { useAccount, useDisconnect } from "wagmi"
import { IconCopy, IconSignOut } from "@initia/icons-react"
import { truncate } from "@/public/utils"
import { useInterwovenKit } from "@/public/data/hooks"
import { useDrawer } from "@/data/ui"
import CopyButton from "@/components/CopyButton"
import Image from "@/components/Image"
import styles from "./WidgetHeader.module.css"

const WidgetHeader = () => {
  const { connector } = useAccount()
  const { disconnect } = useDisconnect()
  const { address, username } = useInterwovenKit()
  const { closeDrawer } = useDrawer()
  const name = username ?? address

  // wagmi cannot detect when wallet gets locked while the window is open
  useEffect(() => {
    if (connector) {
      ;(async () => {
        try {
          // every time the drawer is opened, check if the wallet is still connected
          // not ideal, but since no event is emitted when the wallet is locked there is no much we can do
          const isAuthorized = await connector.isAuthorized?.()
          if (!isAuthorized) {
            closeDrawer()
            disconnect()
          }
        } catch {
          closeDrawer()
          disconnect()
        }
      })()
    }
  }, [connector]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!connector) {
    return null
  }

  return (
    <header className={styles.header}>
      <div className={styles.logo}>
        <Image src={connector.icon} width={18} height={18} />
      </div>

      <CopyButton value={address}>
        {({ copy, copied }) => (
          <button className={clsx(styles.copy, { [styles.copied]: copied })} onClick={copy}>
            <div className={styles.address}>{truncate(address)}</div>
            <div className={styles.name}>{truncate(name)}</div>
            <IconCopy className={styles.icon} size={12} />
            {copied ? "Copied!" : ""}
          </button>
        )}
      </CopyButton>

      <button
        className={styles.disconnect}
        onClick={() => {
          closeDrawer()
          disconnect()
        }}
      >
        <IconSignOut size={18} />
      </button>
    </header>
  )
}

export default WidgetHeader
