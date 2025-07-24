import xss from "xss"
import clsx from "clsx"
import { path } from "ramda"
import type { AnchorHTMLAttributes } from "react"
import { truncate } from "@/public/utils"
import { useChain } from "@/data/chains"
import { IconExternalLink } from "@initia/icons-react"
import styles from "./ExplorerLink.module.css"

interface Props extends AnchorHTMLAttributes<HTMLAnchorElement> {
  chainId: string
  txHash?: string
  accountAddress?: string
  suffixPath?: string
  showIcon?: boolean
  onClick?: () => void
}

const ExplorerLink = (props: Props) => {
  const {
    chainId,
    txHash,
    accountAddress,
    suffixPath,
    showIcon,
    className,
    children,
    onClick,
    ...attrs
  } = props
  const chain = useChain(chainId)

  let url: string | undefined
  let defaultText: string

  if (txHash) {
    const txPage = path<string>(["explorers", 0, "tx_page"], chain)
    url = txPage?.replace(/\$\{txHash\}/g, txHash)
    defaultText = truncate(txHash)
  } else if (accountAddress) {
    const accountPage = path<string>(["explorers", 0, "account_page"], chain)
    url = accountPage?.replace(/\$\{accountAddress\}/g, accountAddress)
    if (url && suffixPath) {
      url = url + suffixPath
    }
    defaultText = truncate(accountAddress)
  } else {
    defaultText = ""
  }

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

function sanitizeLink(href: string): string {
  try {
    const url = new URL(href, window.location.href)
    if (!["http:", "https:"].includes(url.protocol)) {
      throw new Error("Invalid protocol")
    }
    return url.toString()
  } catch {
    return "#"
  }
}
