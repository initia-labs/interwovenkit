import clsx from "clsx"
import { useAccount } from "wagmi"
import { useState, useRef, useEffect } from "react"
import { useSpring, animated } from "@react-spring/web"
import { IconCopy, IconQrCode, IconSignOut } from "@initia/icons-react"
import { truncate } from "@initia/utils"
import { useInterwovenKit } from "@/public/data/hooks"
import { useDisconnect } from "@/data/ui"
import { useDefaultChain } from "@/data/chains"
import ModalTrigger from "@/components/ModalTrigger"
import CopyButton from "@/components/CopyButton"
import Image from "@/components/Image"
import AddressQr from "./AddressQr"
import styles from "./WidgetHeader.module.css"

const WidgetHeader = () => {
  const deafultChain = useDefaultChain()
  const { connector } = useAccount()
  const disconnect = useDisconnect()
  const { address, username } = useInterwovenKit()
  const name = username ?? address

  const [isExpanded, setIsExpanded] = useState(false)
  const timeoutRef = useRef<NodeJS.Timeout | null>(null)

  const springProps = useSpring({
    width: isExpanded ? 140 : 52,
    config: { tension: 500, friction: 30, clamp: true },
  })

  const handleDisconnectClick = () => {
    if (!isExpanded) {
      setIsExpanded(true)
    } else {
      disconnect()
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
        <ModalTrigger
          title="Initia address"
          content={() => <AddressQr />}
          className={clsx(styles.button, styles.qr)}
        >
          <IconQrCode size={16} />
        </ModalTrigger>
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
