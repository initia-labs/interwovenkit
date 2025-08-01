import xss from "xss"
import clsx from "clsx"
import type { AnchorHTMLAttributes } from "react"
import { truncate } from "@initia/utils"
import { useChain } from "@/data/chains"
import { IconExternalLink } from "@initia/icons-react"
import { buildExplorerUrl, sanitizeLink } from "./explorer"
import styles from "./ExplorerLink.module.css"

interface Props extends AnchorHTMLAttributes<HTMLAnchorElement> {
  chainId: string
  txHash?: string
  accountAddress?: string
  pathSuffix?: string
  showIcon?: boolean
  onClick?: () => void
}

const ExplorerLink = ({ chainId, txHash, accountAddress, pathSuffix, ...props }: Props) => {
  const { showIcon, className, children, onClick, ...attrs } = props
  const chain = useChain(chainId)

  const url = buildExplorerUrl(chain, { txHash, accountAddress, pathSuffix })
  const defaultText = txHash ? truncate(txHash) : accountAddress ? truncate(accountAddress) : ""
  const text = children ?? defaultText

  if (!url) {
    return <span {...attrs}>{text}</span>
  }

  return (
    <a
      {...attrs}
      href={xss(sanitizeLink(url))}
      className={clsx(styles.link, className)}
      onClick={onClick}
      target="_blank"
    >
      {text}
      {showIcon && <IconExternalLink size={12} />}
    </a>
  )
}

export default ExplorerLink
