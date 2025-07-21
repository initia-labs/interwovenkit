import clsx from "clsx"
import { useAccount, useDisconnect } from "wagmi"
import { IconCopy, IconQrCode, IconSignOut } from "@initia/icons-react"
import { truncate } from "@/public/utils"
import { useInterwovenKit } from "@/public/data/hooks"
import { useDrawer } from "@/data/ui"
import { useModal } from "./ModalContext"
import CopyButton from "@/components/CopyButton"
import Image from "@/components/Image"
import AddressQrCode from "@/components/AddressQrCode"
import styles from "./WidgetHeader.module.css"

const WidgetHeader = () => {
  const { connector } = useAccount()
  const { disconnect } = useDisconnect()
  const { address, username } = useInterwovenKit()
  const { closeDrawer } = useDrawer()
  const { openModal } = useModal()
  const name = username ?? address

  if (!connector) {
    return null
  }

  return (
    <header className={styles.header}>
      <div className={styles.addressContainer}>
        <Image src={connector.icon} width={18} height={18} />
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
      </div>

      <button
        className={styles.qrcode}
        onClick={() => openModal({ title: "Address", content: <AddressQrCode /> })}
      >
        <IconQrCode size={18} />
      </button>

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
