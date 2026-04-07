import clsx from "clsx"
import xss from "xss"
import { IconExternalLink } from "@initia/icons-react"
import { truncate } from "@initia/utils"
import { isDeletedChain, useFindChainDisplay } from "@/data/chains"
import { buildExplorerUrl, sanitizeLink } from "./explorer"
import styles from "./ExplorerLink.module.css"

import type { AnchorHTMLAttributes } from "react"

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
  const findChainDisplay = useFindChainDisplay()
  const defaultText = txHash ? truncate(txHash) : accountAddress ? truncate(accountAddress) : ""
  const text = children ?? defaultText

  const renderFallback = () => (
    <span {...attrs} className={clsx(styles.link, className)}>
      {text}
    </span>
  )

  let chain
  try {
    chain = findChainDisplay(chainId)
  } catch {
    return renderFallback()
  }

  if (isDeletedChain(chain)) {
    return renderFallback()
  }

  const url = buildExplorerUrl(chain, { txHash, accountAddress, pathSuffix })
  if (!url) {
    return renderFallback()
  }

  return (
    <a
      {...attrs}
      href={xss(sanitizeLink(url))}
      className={clsx(styles.link, className)}
      onClick={onClick}
      target="_blank"
      rel="noopener noreferrer"
    >
      {text}
      {showIcon && <IconExternalLink size={12} aria-hidden="true" />}
    </a>
  )
}

export default ExplorerLink
