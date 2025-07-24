import { useRef, useState } from "react"
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
import { animated, config, useSpring } from "@react-spring/web"

const WidgetHeader = () => {
  const { connector } = useAccount()
  const { disconnect } = useDisconnect()
  const { address, username } = useInterwovenKit()
  const { closeDrawer } = useDrawer()
  const { openModal } = useModal()
  const name = username ?? address

  const [disconnecting, setDisconnecting] = useState(false)
  const timerRef = useRef<NodeJS.Timeout>(null!)

  const style = useSpring({
    column: disconnecting ? 128 : 52,
    config: { ...config.stiff, clamp: true },
  })

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
    <animated.div
      className={clsx(styles.header)}
      style={{ gridTemplateColumns: style.column.to((v) => `1fr 52px ${v}px`) }}
    >
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
        onClick={handleDisconnect}
        onMouseLeave={() => (timerRef.current = setTimeout(() => setDisconnecting(false), 1000))}
        onMouseEnter={() => clearTimeout(timerRef.current)}
      >
        <IconSignOut size={16} />
        {disconnecting && "Disconnect"}
      </button>
    </animated.div>
  )
}

export default WidgetHeader
