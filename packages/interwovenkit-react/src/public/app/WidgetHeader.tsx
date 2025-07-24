import { useEffect, useState } from "react"
import clsx from "clsx"
import { useAccount, useDisconnect } from "wagmi"
import { IconCopy, IconQrCode, IconSignOut } from "@initia/icons-react"
import { truncate } from "@/public/utils"
import { useInterwovenKit } from "@/public/data/hooks"
import { useDrawer } from "@/data/ui"
import { LocalStorageKey } from "@/data/constants"
import { useModal } from "./ModalContext"
import CopyButton from "@/components/CopyButton"
import Image from "@/components/Image"
import AddressQrList from "./AddressQrList"
import styles from "./WidgetHeader.module.css"

const WidgetHeader = () => {
  const { connector } = useAccount()
  const { disconnect } = useDisconnect()
  const { address, username } = useInterwovenKit()
  const { closeDrawer } = useDrawer()
  const { openModal } = useModal()
  const name = username ?? address

  const [disconnecting, setDisconnecting] = useState(false)

  useEffect(() => {
    // Reset disconnecting state when something else is clicked
    const handleClick = (event: MouseEvent) => {
      const target = event.target as Element | null
      if (!target?.closest(`.${styles.button}`)) {
        setDisconnecting(false)
      }
    }

    if (disconnecting) {
      document.addEventListener("click", handleClick)
      return () => {
        document.removeEventListener("click", handleClick)
      }
    }
  }, [disconnecting, setDisconnecting])

  function handleDisconnect() {
    if (disconnecting) {
      closeDrawer()
      disconnect()

      // Clear bridge form values on disconnect
      localStorage.removeItem(LocalStorageKey.BRIDGE_SRC_CHAIN_ID)
      localStorage.removeItem(LocalStorageKey.BRIDGE_SRC_DENOM)
      localStorage.removeItem(LocalStorageKey.BRIDGE_DST_CHAIN_ID)
      localStorage.removeItem(LocalStorageKey.BRIDGE_DST_DENOM)
      localStorage.removeItem(LocalStorageKey.BRIDGE_QUANTITY)
      localStorage.removeItem(LocalStorageKey.BRIDGE_SLIPPAGE_PERCENT)
    } else {
      setDisconnecting(true)
    }
  }

  if (!connector) {
    return null
  }

  return (
    <header className={clsx(styles.header, { [styles.disconnecting]: disconnecting })}>
      <CopyButton value={address}>
        {({ copy, copied }) => (
          <button className={clsx(styles.account, { [styles.copied]: copied })} onClick={copy}>
            <Image src={connector.icon} width={18} height={18} />
            <div className={styles.address}>{truncate(address)}</div>
            <div className={styles.name}>{truncate(name)}</div>
            <IconCopy className={styles.icon} size={12} />
            {copied ? "Copied!" : ""}
          </button>
        )}
      </CopyButton>

      {!disconnecting && (
        <button
          className={styles.button}
          onClick={() => openModal({ title: "Address", content: <AddressQrList /> })}
        >
          <IconQrCode size={16} />
        </button>
      )}

      <button className={styles.button} onClick={handleDisconnect}>
        <IconSignOut size={16} />
        {disconnecting && "Disconnect"}
      </button>
    </header>
  )
}

export default WidgetHeader
