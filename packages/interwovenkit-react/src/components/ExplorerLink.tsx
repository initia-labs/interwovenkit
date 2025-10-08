import clsx from "clsx"
import xss from "xss"
import { IconExternalLink } from "@initia/icons-react"
import { truncate } from "@initia/utils"
import { useChain } from "@/data/chains"
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
  const chain = useChain(chainId)

  const url = buildExplorerUrl(chain, { txHash, accountAddress, pathSuffix })
  const defaultText = txHash ? truncate(txHash) : accountAddress ? truncate(accountAddress) : ""
  const text = children ?? defaultText

  if (!url) {
    return (
      <span {...attrs} className={clsx(styles.link, className)}>
        {text}
      </span>
    )
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
