import type { ReactNode } from "react"
import { useLocalStorage } from "usehooks-ts"
import { IconChevronUp, IconChevronDown, IconSettingFilled } from "@initia/icons-react"
import { Link } from "@/lib/router"
import { version } from "@/../package.json"
import { LocalStorageKey } from "@/data/constants"
import { useConfig } from "@/data/config"
import type { NormalizedChain } from "@/data/chains"
import { useManageChains } from "@/data/chains"
import WidgetAccordion from "@/components/WidgetAccordion"
import FlexEnd from "@/components/FlexEnd"
import Button from "@/components/Button"
import Image from "@/components/Image"
import styles from "./ChainAccordion.module.css"

interface Props {
  renderContent: (chain: NormalizedChain) => ReactNode
  storageKey: string
}

const ChainAccordion = ({ renderContent, storageKey }: Props) => {
  const { defaultChainId } = useConfig()
  const { addedChains } = useManageChains()

  const [openedChains, setOpenedChains] = useLocalStorage<string[]>(
    `${LocalStorageKey.OPENED_CHAIN_IDS}:${storageKey}`,
    [defaultChainId],
  )

  const isAllCollapsed = openedChains.length === 0
  const handleToggleAll = () => {
    if (isAllCollapsed) {
      setOpenedChains(addedChains.map((chain) => chain.chainId))
    } else {
      setOpenedChains([])
    }
  }

  return (
    <>
      <FlexEnd mb={6}>
        <Button.Small className={styles.toggle} onClick={handleToggleAll}>
          <span>{isAllCollapsed ? "Expand all" : "Collapse all"}</span>
          {isAllCollapsed ? <IconChevronDown size={10} /> : <IconChevronUp size={10} />}
        </Button.Small>
      </FlexEnd>

      <WidgetAccordion
        list={addedChains}
        getKey={({ chainId }) => chainId}
        renderHeader={({ name, logoUrl }) => (
          <>
            <Image src={logoUrl} width={16} height={16} />
            <span className={styles.name}>{name}</span>
          </>
        )}
        renderContent={renderContent}
        value={openedChains}
        onValueChange={setOpenedChains}
        footer={
          <Link className={styles.rollups} to="/rollups">
            <IconSettingFilled size={12} />
            <span>Manage rollup list</span>
          </Link>
        }
      />

      <FlexEnd mt={8}>
        <span className={styles.version}>v{version}</span>
      </FlexEnd>
    </>
  )
}

export default ChainAccordion
