import { useState, useMemo, useRef, useEffect, type RefObject } from "react"
import { Collapsible } from "radix-ui"
import { useSpring, animated } from "@react-spring/web"
import { IconChevronDown } from "@initia/icons-react"
import { usePortfolio } from "@/data/portfolio"
import Status from "@/components/Status"
import ChainSelect from "@/components/ChainSelect"
import HomeContainer from "../../components/HomeContainer"
import AssetGroup from "./AssetGroup"
import styles from "./Assets.module.css"

const Assets = ({ scrollableRef }: { scrollableRef?: RefObject<HTMLDivElement | null> }) => {
  const [searchQuery, setSearchQuery] = useState("")
  const [selectedChain, setSelectedChain] = useState("")
  const [isUnsupportedOpen, setIsUnsupportedOpen] = useState(false)
  const { assetGroups, unsupportedAssetGroups, chainPortfolios, isLoading } = usePortfolio()
  const chainIds = chainPortfolios.map((c) => c.chain.chainId)

  // Filter assets based on selected chain and search query
  const filteredAssets = useMemo(() => {
    const searchFiltered = searchQuery
      ? assetGroups.filter((assetGroup) => {
          const { denom, symbol, name, address } = assetGroup.asset
          return (
            denom.toLowerCase().includes(searchQuery.toLowerCase()) ||
            symbol.toLowerCase().includes(searchQuery.toLowerCase()) ||
            name?.toLowerCase().includes(searchQuery.toLowerCase()) ||
            address?.toLowerCase().includes(searchQuery.toLowerCase())
          )
        })
      : assetGroups

    const chainFiltered = selectedChain
      ? searchFiltered
          .map((assetGroup) => ({
            ...assetGroup,
            chains: assetGroup.chains.filter(({ chain }) => chain.chainId === selectedChain),
          }))
          .filter((assetGroup) => assetGroup.chains.length > 0)
      : searchFiltered

    return chainFiltered
  }, [assetGroups, searchQuery, selectedChain])

  // Filter unsupported assets based on selected chain and search query
  const filteredUnsupportedAssets = useMemo(() => {
    const searchFiltered = searchQuery
      ? unsupportedAssetGroups.filter((assetGroup) => {
          const { denom } = assetGroup.asset
          return denom.toLowerCase().includes(searchQuery.toLowerCase())
        })
      : unsupportedAssetGroups

    const chainFiltered = selectedChain
      ? searchFiltered
          .map((assetGroup) => ({
            ...assetGroup,
            chains: assetGroup.chains.filter(({ chain }) => chain.chainId === selectedChain),
          }))
          .filter((assetGroup) => assetGroup.chains.length > 0)
      : searchFiltered

    return chainFiltered
  }, [unsupportedAssetGroups, searchQuery, selectedChain])

  // Animation for collapsible content using measureRef for auto height
  const contentRef = useRef<HTMLDivElement>(null)
  const [contentHeight, setContentHeight] = useState(0)

  useEffect(() => {
    if (contentRef.current) {
      const height = contentRef.current.scrollHeight
      setContentHeight(height)
    }
  }, [filteredUnsupportedAssets])

  // Scroll to bottom when opened
  useEffect(() => {
    if (isUnsupportedOpen && scrollableRef?.current) {
      const container = scrollableRef.current
      container.scrollTo({ top: container.scrollHeight, behavior: "instant" })
      setTimeout(() => {
        if (container) {
          container.scrollTo({ top: container.scrollHeight, behavior: "smooth" })
        }
      }, 150)
    }
  }, [isUnsupportedOpen, scrollableRef])

  const animationStyles = useSpring({
    height: isUnsupportedOpen ? contentHeight : 0,
    opacity: isUnsupportedOpen ? 1 : 0,
    config: { tension: 500, friction: 30, clamp: true },
  })

  // Show loading only on initial load when no data exists yet
  // This prevents flickering when refetching with existing data
  if (isLoading && assetGroups.length === 0) {
    return <Status>Loading assets...</Status>
  }

  if (
    !filteredAssets.length &&
    !filteredUnsupportedAssets.length &&
    !searchQuery &&
    !selectedChain &&
    !isLoading
  ) {
    return <Status>No assets</Status>
  }

  return (
    <HomeContainer.Root>
      <HomeContainer.Controls>
        <HomeContainer.SearchInput
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="Search assets"
        />
        <ChainSelect value={selectedChain} onChange={setSelectedChain} chainIds={chainIds} />
      </HomeContainer.Controls>

      {filteredAssets.length === 0 && filteredUnsupportedAssets.length === 0 ? (
        <Status>No assets found</Status>
      ) : (
        <div className={styles.list}>
          {filteredAssets.map((assetGroup) => (
            <AssetGroup assetGroup={assetGroup} key={assetGroup.asset.symbol} />
          ))}

          {filteredUnsupportedAssets.length > 0 && (
            <Collapsible.Root
              open={isUnsupportedOpen}
              onOpenChange={setIsUnsupportedOpen}
              className={styles.unsupportedCollapsible}
            >
              <Collapsible.Trigger className={styles.unsupportedTrigger}>
                <div className={styles.divider} />
                <span className={styles.unsupportedLabel}>
                  Unsupported assets ({filteredUnsupportedAssets.length})
                </span>
                <IconChevronDown
                  className={styles.chevron}
                  size={12}
                  data-state={isUnsupportedOpen ? "open" : "closed"}
                />
                <div className={styles.divider} />
              </Collapsible.Trigger>

              <Collapsible.Content forceMount asChild>
                <animated.div className={styles.unsupportedContent} style={animationStyles}>
                  <div className={styles.unsupportedList} ref={contentRef}>
                    {filteredUnsupportedAssets.map((assetGroup) => (
                      <AssetGroup
                        assetGroup={assetGroup}
                        key={assetGroup.asset.denom}
                        isUnsupported
                      />
                    ))}
                  </div>
                </animated.div>
              </Collapsible.Content>
            </Collapsible.Root>
          )}
        </div>
      )}
    </HomeContainer.Root>
  )
}

export default Assets
