import clsx from "clsx"
import { useAccount, useDisconnect } from "wagmi"
import { IconCopy, IconQrCode, IconSignOut } from "@initia/icons-react"
import { truncate } from "@/public/utils"
import { useInterwovenKit } from "@/public/data/hooks"
import { useDrawer } from "@/data/ui"
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

  if (!connector) {
    return null
  }

  return (
    <header className={styles.header}>
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

      <button
        className={styles.button}
        onClick={() => openModal({ title: "Address", content: <AddressQrList /> })}
      >
        <IconQrCode size={16} />
      </button>

      <button
        className={styles.button}
        onClick={() => {
          closeDrawer()
          disconnect()
        }}
      >
        <IconSignOut size={16} />
      </button>
    </header>
  )
}

export default WidgetHeader
