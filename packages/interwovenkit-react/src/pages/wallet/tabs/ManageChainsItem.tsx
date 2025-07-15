import xss from "xss"
import { IconExternalLink, IconMinus, IconPlus } from "@initia/icons-react"
import { useConfig } from "@/data/config"
import type { NormalizedChain } from "@/data/chains"
import { useManageChains } from "@/data/chains"
import Image from "@/components/Image"
import styles from "./ManageChainsItem.module.css"
import Amplitude from "@/lib/amplitude"

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
        <button
          className={styles.button}
          onClick={() => {
            Amplitude.logEvent("Rollup_added", { chain: chainId })
            addChain(chainId)
          }}
        >
          <IconPlus size={14} />
        </button>
      )
    }

    return (
      <button
        className={styles.button}
        onClick={() => {
          Amplitude.logEvent("Rollup_hidden", { chain: chainId })
          removeChain(chainId)
        }}
      >
        <IconMinus size={14} />
      </button>
    )
  }

  return (
    <div className={styles.item}>
      <Image src={logoUrl} width={32} height={32} title={metadata?.minitia?.type} />

      <header className={styles.header}>
        <h3 className={styles.name}>{name}</h3>
        {website && (
          <a className={styles.link} href={xss(website)} target="_blank">
            <IconExternalLink
              size={12}
              data-amp-track-name="Manage_rollup_link_clicked"
              data-amp-track-chain={chainId}
            />
          </a>
        )}
      </header>

      {renderButton()}
    </div>
  )
}

export default ManageChainsItem
