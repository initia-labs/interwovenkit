import { Accordion } from "radix-ui"
import type { NormalizedChain } from "@/data/chains"
import { useSortedBalancesWithValue } from "@/data/account"
import Status from "@/components/Status"
import AssetItem from "./AssetItem"
import AssetActions from "./AssetActions"
import styles from "./AssetList.module.css"

const AssetList = (chain: NormalizedChain) => {
  const assets = useSortedBalancesWithValue(chain)

  if (!assets.length) {
    return <Status>No assets</Status>
  }

  return (
    <Accordion.Root type="single" collapsible className={styles.list}>
      {assets.map((asset) => (
        <Accordion.Item className={styles.item} value={asset.denom} key={asset.denom}>
          <Accordion.Header>
            <Accordion.Trigger className={styles.trigger}>
              <AssetItem {...asset} />
            </Accordion.Trigger>
          </Accordion.Header>

          <Accordion.Content className={styles.content}>
            <AssetActions denom={asset.denom} chain={chain} />
          </Accordion.Content>
        </Accordion.Item>
      ))}
    </Accordion.Root>
  )
}

export default AssetList
