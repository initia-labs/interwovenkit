import clsx from "clsx"
import { useCallback, useEffect, useMemo, useState } from "react"
import Image from "@/components/Image"
import Status from "@/components/Status"
import { useFindSkipChain, useSkipChains } from "../data/chains"
import { useBridgeForm } from "../data/form"
import AssetResultRow from "./AssetResultRow"
import ChainBar from "./ChainBar"
import PopularAssets from "./PopularAssets"
import RecentPairs from "./RecentPairs"
import ResultSection from "./ResultSection"
import type { RecentPair } from "./types"
import UnifiedSearchInput from "./UnifiedSearchInput"
import { useKeyboardNavigation } from "./useKeyboardNavigation"
import { useMultiChainBalances } from "./useMultiChainBalances"
import { useRecentPairs } from "./useRecentPairs"
import { useUnifiedSearch } from "./useUnifiedSearch"
import YourAssets from "./YourAssets"
import chainBarStyles from "./ChainBar.module.css"
import styles from "./UnifiedSearch.module.css"

interface Props {
  type: "src" | "dst"
  afterSelect: () => void
}

const UnifiedSearch = ({ type, afterSelect }: Props) => {
  const chainIdKey = type === "src" ? "srcChainId" : "dstChainId"
  const denomKey = type === "src" ? "srcDenom" : "dstDenom"

  const { setValue } = useBridgeForm()
  const findChain = useFindSkipChain()
  const allChains = useSkipChains()
  const { pairs, addPair } = useRecentPairs()

  const [search, setSearch] = useState("")
  const [lockedChainId, setLockedChainId] = useState<string | null>(null)

  const hasSearchTerm = search.trim().length > 0
  const showDefault = !hasSearchTerm && !lockedChainId

  const allChainIds = useMemo(
    () => allChains.filter((c) => !c.hidden).map((c) => c.chain_id),
    [allChains],
  )
  const { balanceMap, isLoading: isLoadingBalances } = useMultiChainBalances(allChainIds)

  const { chains, assets } = useUnifiedSearch({ query: search, lockedChainId, balanceMap })

  const lockedChain = useMemo(() => {
    if (!lockedChainId) return null
    const chain = findChain(lockedChainId)
    return { name: chain.pretty_name || chain.chain_name, logoUrl: chain.logo_uri ?? "" }
  }, [lockedChainId, findChain])

  const flatItems = useMemo(() => {
    const items: Array<{ type: "chain"; index: number } | { type: "asset"; index: number }> = []
    chains.forEach((_, i) => items.push({ type: "chain", index: i }))
    assets.forEach((_, i) => items.push({ type: "asset", index: i }))
    return items
  }, [chains, assets])

  const handleSelectAsset = useCallback(
    (chainId: string, denom: string) => {
      setValue(chainIdKey, chainId)
      setValue(denomKey, denom)
      afterSelect()
    },
    [setValue, chainIdKey, denomKey, afterSelect],
  )

  const handleSelectChain = useCallback((chainId: string) => {
    setLockedChainId(chainId)
    setSearch("")
  }, [])

  const handleSelectRecentPair = useCallback(
    (pair: RecentPair) => {
      setValue("srcChainId", pair.srcChainId)
      setValue("srcDenom", pair.srcDenom)
      setValue("dstChainId", pair.dstChainId)
      setValue("dstDenom", pair.dstDenom)
      addPair(pair)
      afterSelect()
    },
    [setValue, addPair, afterSelect],
  )

  const handleFlatSelect = useCallback(
    (index: number) => {
      const item = flatItems[index]
      if (!item) return
      if (item.type === "chain") handleSelectChain(chains[item.index].chain_id)
      if (item.type === "asset") {
        const asset = assets[item.index]
        handleSelectAsset(asset.chainId, asset.denom)
      }
    },
    [flatItems, chains, assets, handleSelectChain, handleSelectAsset],
  )

  const { highlightIndex, handleKeyDown, resetHighlight, listRef } = useKeyboardNavigation({
    itemCount: flatItems.length,
    onSelect: handleFlatSelect,
    onEscape: afterSelect,
    onBackspace: () => {
      if (lockedChainId) setLockedChainId(null)
    },
    inputEmpty: !hasSearchTerm,
  })

  const handleSearchChange = useCallback(
    (value: string) => {
      setSearch(value)
      resetHighlight()
    },
    [resetHighlight],
  )

  useEffect(() => {
    listRef.current?.scrollTo(0, 0)
  }, [showDefault, search, lockedChainId, listRef])

  useEffect(() => {
    resetHighlight()
  }, [lockedChainId, resetHighlight])

  const hasResults = chains.length > 0 || assets.length > 0
  const assetHighlightOffset = chains.length

  return (
    <div className={styles.container}>
      <UnifiedSearchInput
        lockedChain={lockedChain}
        onRemoveChain={() => setLockedChainId(null)}
        search={search}
        onSearchChange={handleSearchChange}
        onKeyDown={handleKeyDown}
      />

      <div className={styles.list} ref={listRef}>
        {showDefault && (
          <>
            <ChainBar onSelect={handleSelectChain} />
            <PopularAssets onSelect={handleSearchChange} />
            {pairs.length > 0 && (
              <RecentPairs pairs={pairs} onSelectPair={handleSelectRecentPair} />
            )}
            <YourAssets
              balanceMap={balanceMap}
              isLoading={isLoadingBalances}
              onSelect={handleSelectAsset}
            />
          </>
        )}

        {!showDefault && (
          <>
            {!hasResults && <Status>No results for &ldquo;{search.trim()}&rdquo;</Status>}

            {chains.length > 0 && (
              <ResultSection label="Chains">
                <div className={chainBarStyles.wrap}>
                  {chains.map((chain, i) => (
                    <button
                      key={chain.chain_id}
                      type="button"
                      className={clsx(chainBarStyles.chip, {
                        [chainBarStyles.chipHighlighted]: highlightIndex === i,
                      })}
                      onClick={() => handleSelectChain(chain.chain_id)}
                      data-search-item
                    >
                      <Image src={chain.logo_uri ?? undefined} width={18} height={18} logo />
                      <span className={chainBarStyles.name}>
                        {chain.pretty_name || chain.chain_name}
                      </span>
                    </button>
                  ))}
                </div>
              </ResultSection>
            )}

            {assets.length > 0 && (
              <ResultSection label={lockedChainId ? `Assets on ${lockedChain?.name}` : "Assets"}>
                {assets.map((asset, i) => (
                  <AssetResultRow
                    key={`${asset.chainId}-${asset.denom}`}
                    asset={asset}
                    balance={balanceMap[asset.chainId]?.[asset.denom]}
                    highlighted={highlightIndex === assetHighlightOffset + i}
                    hideChainName={!!lockedChainId}
                    onSelect={handleSelectAsset}
                  />
                ))}
              </ResultSection>
            )}
          </>
        )}
      </div>
    </div>
  )
}

export default UnifiedSearch
