import clsx from "clsx"
import { Collapsible } from "radix-ui"
import { useMemo } from "react"
import { atom, useAtom } from "jotai"
import { IconChevronDown, IconExternalLink } from "@initia/icons-react"
import Image from "@/components/Image"
import { useAllChainsAssetsQueries } from "@/data/assets"
import { useInitiaRegistry } from "@/data/chains"
import {
  buildAssetLogoMaps,
  getPositionValue,
  type PortfolioChainPositionGroup,
} from "@/data/minity"
import { formatValue } from "@/lib/format"
import CivitiaSection from "./CivitiaSection"
import PositionSectionList, { type DenomLogoMap } from "./PositionSection"
import styles from "./AppchainPositionGroup.module.css"

const openPositionGroupsAtom = atom<string[]>([])

interface Props {
  chainGroup: PortfolioChainPositionGroup
}

/* -------------------------------------------------------------------------- */
/*                           Position Section Content                         */
/* -------------------------------------------------------------------------- */

interface PositionSectionContentProps {
  chainGroup: PortfolioChainPositionGroup
}

const AppchainPositionContent = ({ chainGroup }: PositionSectionContentProps) => {
  const { chainId, chainLogo, protocols } = chainGroup

  // Asset logos (non-blocking - renders immediately, logos appear when ready)
  const chains = useInitiaRegistry()
  const assetsQueries = useAllChainsAssetsQueries()
  const { denomLogos, symbolLogos } = useMemo(
    () => buildAssetLogoMaps(assetsQueries, chains),
    [assetsQueries, chains],
  )

  // Build combined denom -> logo map with fallback logic
  const denomLogoMap: DenomLogoMap = useMemo(() => {
    const map = new Map<string, { assetLogo: string; chainLogo: string }>()

    for (const protocol of protocols) {
      for (const position of protocol.positions) {
        if (position.type === "fungible-position") continue
        if (position.balance.type === "unknown") continue

        const { denom, symbol } = position.balance
        const upperSymbol = symbol.toUpperCase()
        const chainDenomKey = `${chainId}:${denom}`
        const assetLogo = denomLogos.get(chainDenomKey) ?? symbolLogos.get(upperSymbol)

        if (assetLogo) {
          map.set(denom, { assetLogo, chainLogo: chainLogo ?? "" })
        }
      }
    }

    return map
  }, [protocols, denomLogos, symbolLogos, chainId, chainLogo])

  return <PositionSectionList protocols={protocols} denomLogoMap={denomLogoMap} />
}

/* -------------------------------------------------------------------------- */
/*                           Main Component                                   */
/* -------------------------------------------------------------------------- */

const AppchainPositionGroup = ({ chainGroup }: Props) => {
  const { chainName, chainLogo, protocols } = chainGroup

  // Get the manage URL from first protocol
  const manageUrl = protocols[0]?.manageUrl

  const [openGroups, setOpenGroups] = useAtom(openPositionGroupsAtom)

  // Calculate total value for this chain group
  const totalValue = useMemo(() => {
    return protocols.reduce((sum, protocol) => {
      return (
        sum +
        protocol.positions.reduce(
          (positionSum, position) => positionSum + getPositionValue(position),
          0,
        )
      )
    }, 0)
  }, [protocols])

  // Chains excluded from value calculations (fungible NFTs only, no USD values)
  const excludedChains = ["civitia", "yominet"]

  const isOpen = openGroups.includes(chainName)
  const chainNameLower = chainName?.toLowerCase()
  const isCivitia = chainNameLower === "civitia"
  const hideValue = excludedChains.includes(chainNameLower)

  const toggleOpen = () => {
    setOpenGroups((prev) =>
      isOpen ? prev.filter((name) => name !== chainName) : [...new Set([...prev, chainName])],
    )
  }

  return (
    <div className={styles.container}>
      <Collapsible.Root open={isOpen} onOpenChange={toggleOpen}>
        <Collapsible.Trigger asChild>
          <button className={styles.trigger}>
            <div className={styles.chainInfo}>
              {chainLogo && (
                <Image src={chainLogo} width={32} height={32} className={styles.logo} logo />
              )}
              <div className={styles.chainNameContainer}>
                <span className={styles.chainName}>{chainName}</span>
                {manageUrl && (
                  <a
                    href={manageUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className={styles.externalLink}
                    onClick={(e) => e.stopPropagation()}
                  >
                    <IconExternalLink size={12} className={styles.externalIcon} />
                  </a>
                )}
              </div>
            </div>
            <div className={styles.valueColumn}>
              {!hideValue && <span className={styles.value}>{formatValue(totalValue)}</span>}
              <IconChevronDown
                size={16}
                className={clsx(styles.expandIcon, { [styles.expanded]: isOpen })}
              />
            </div>
          </button>
        </Collapsible.Trigger>

        <Collapsible.Content className={styles.collapsibleContent}>
          <div className={styles.content}>
            <AppchainPositionContent chainGroup={chainGroup} />
            {isCivitia && <CivitiaSection />}
          </div>
        </Collapsible.Content>
      </Collapsible.Root>
    </div>
  )
}

export default AppchainPositionGroup
