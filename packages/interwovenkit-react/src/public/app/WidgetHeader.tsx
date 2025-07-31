import clsx from "clsx"
import { useAccount, useDisconnect } from "wagmi"
import { useState, useRef, useEffect } from "react"
import { useSpring, animated } from "@react-spring/web"
import { IconCopy, IconQrCode, IconSignOut } from "@initia/icons-react"
import { truncate } from "@initia/utils"
import { useNavigate } from "@/lib/router"
import { useInterwovenKit } from "@/public/data/hooks"
import { useDrawer } from "@/data/ui"
import { LocalStorageKey } from "@/data/constants"
import { useDefaultChain } from "@/data/chains"
import CopyButton from "@/components/CopyButton"
import Image from "@/components/Image"
import { useModal } from "./ModalContext"
import AddressQr from "./AddressQr"
import styles from "./WidgetHeader.module.css"

const WidgetHeader = () => {
  const navigate = useNavigate()
  const deafultChain = useDefaultChain()
  const { connector } = useAccount()
  const { disconnect } = useDisconnect()
  const { address, username } = useInterwovenKit()
  const { closeDrawer } = useDrawer()
  const { openModal } = useModal()
  const name = username ?? address

  const [isExpanded, setIsExpanded] = useState(false)
  const timeoutRef = useRef<NodeJS.Timeout | null>(null)

  const springProps = useSpring({
    width: isExpanded ? 140 : 52,
    config: { tension: 300, friction: 30, clamp: true },
  })

  const handleDisconnectClick = () => {
    if (!isExpanded) {
      setIsExpanded(true)
    } else {
      navigate("/blank")
      closeDrawer()
      disconnect()

      // Clear bridge form values on disconnect
      localStorage.removeItem(LocalStorageKey.BRIDGE_SRC_CHAIN_ID)
      localStorage.removeItem(LocalStorageKey.BRIDGE_SRC_DENOM)
      localStorage.removeItem(LocalStorageKey.BRIDGE_DST_CHAIN_ID)
      localStorage.removeItem(LocalStorageKey.BRIDGE_DST_DENOM)
      localStorage.removeItem(LocalStorageKey.BRIDGE_QUANTITY)
      localStorage.removeItem(LocalStorageKey.BRIDGE_SLIPPAGE_PERCENT)
    }
  }

  const handleMouseLeave = () => {
    if (isExpanded) {
      timeoutRef.current = setTimeout(() => {
        setIsExpanded(false)
      }, 500)
    }
  }

  const handleMouseEnter = () => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current)
      timeoutRef.current = null
    }
  }

  useEffect(() => {
    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current)
      }
    }
  }, [])

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

      {deafultChain.metadata?.is_l1 && (
        <button
          className={styles.button}
          onClick={() => openModal({ title: "Initia address", content: <AddressQr /> })}
        >
          <IconQrCode size={16} />
        </button>
      )}

      <animated.button
        className={clsx(styles.button, styles.disconnect, { [styles.expanded]: isExpanded })}
        style={springProps}
        onClick={handleDisconnectClick}
        onMouseLeave={handleMouseLeave}
        onMouseEnter={handleMouseEnter}
      >
        <IconSignOut size={16} />
        <span className={styles.label}>Disconnect</span>
      </animated.button>
    </header>
  )
}

export default WidgetHeader
