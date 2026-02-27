import { useMemo } from "react"
import Image from "@/components/Image"
import { useBridgeConfig } from "../data/bridgeConfig"
import { useFlatAssets } from "./useFlatAssets"
import styles from "./ChainBar.module.css"

interface Props {
  onSelect: (symbol: string) => void
}

const PopularAssets = ({ onSelect }: Props) => {
  const flatAssets = useFlatAssets()
  const { popularAssetSymbols } = useBridgeConfig()

  const items = useMemo(() => {
    const logoBySymbol = new Map<string, string>()
    for (const asset of flatAssets) {
      if (!asset.symbol || !asset.logoUrl) continue
      if (!logoBySymbol.has(asset.symbol)) {
        logoBySymbol.set(asset.symbol, asset.logoUrl)
      }
    }
    return popularAssetSymbols.map((symbol) => ({
      symbol,
      logoUrl: logoBySymbol.get(symbol),
    }))
  }, [flatAssets, popularAssetSymbols])

  return (
    <div className={styles.section}>
      <span className={styles.label}>Popular assets</span>
      <div className={styles.scroll}>
        {items.map(({ symbol, logoUrl }) => (
          <button
            key={symbol}
            type="button"
            className={styles.chip}
            onClick={() => onSelect(symbol)}
          >
            {logoUrl && <Image src={logoUrl} width={18} height={18} logo />}
            <span className={styles.name}>{symbol}</span>
          </button>
        ))}
      </div>
    </div>
  )
}

export default PopularAssets
