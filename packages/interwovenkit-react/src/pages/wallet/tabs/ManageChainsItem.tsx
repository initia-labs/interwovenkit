import xss from "xss"
import { IconExternalLink, IconMinus, IconPlus } from "@initia/icons-react"
import { useConfig } from "@/data/config"
import type { NormalizedChain } from "@/data/chains"
import { useManageChains } from "@/data/chains"
import Image from "@/components/Image"
import styles from "./ManageChainsItem.module.css"

const ManageChainsItem = (chain: NormalizedChain) => {
  const { chainId, name, logoUrl, website, metadata } = chain
  const { defaultChainId } = useConfig()
  const { addedChains, addChain, removeChain } = useManageChains()

  const isAdded = addedChains.find((chain) => chain.chainId === chainId)

  const renderButton = () => {
    if (chainId === defaultChainId) {
      return null
    }

    if (!isAdded) {
      return (
        <button className={styles.button} onClick={() => addChain(chainId)}>
          <IconPlus size={14} />
        </button>
      )
    }

    return (
      <button className={styles.button} onClick={() => removeChain(chainId)}>
        <IconMinus size={14} />
      </button>
    )
  }

  return (
    <div className={styles.item}>
      <Image src={logoUrl} width={32} height={32} title={metadata?.minitia?.type} logo />

      <header className={styles.header}>
        <h3 className={styles.name}>{name}</h3>
        {website && (
          <a className={styles.link} href={xss(website)} target="_blank">
            <IconExternalLink size={12} />
          </a>
        )}
      </header>

      {renderButton()}
    </div>
  )
}

export default ManageChainsItem
