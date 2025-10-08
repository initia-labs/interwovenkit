import { animated, useSpring } from "@react-spring/web"
import clsx from "clsx"
import { useAccount } from "wagmi"
import { useEffect, useRef, useState } from "react"
import { IconCopy, IconSettingFilled, IconSignOut } from "@initia/icons-react"
import { truncate } from "@initia/utils"
import CopyButton from "@/components/CopyButton"
import Image from "@/components/Image"
import { useDisconnect } from "@/data/ui"
import { useNavigate } from "@/lib/router"
import { useInterwovenKit } from "@/public/data/hooks"
import styles from "./WidgetHeader.module.css"

const WidgetHeader = () => {
  const { connector } = useAccount()
  const disconnect = useDisconnect()
  const navigate = useNavigate()
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

      <button className={clsx(styles.button, styles.qr)} onClick={() => navigate("/settings")}>
        <IconSettingFilled size={16} />
      </button>

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
