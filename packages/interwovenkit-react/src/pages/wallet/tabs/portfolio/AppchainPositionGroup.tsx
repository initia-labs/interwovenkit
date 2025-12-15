import clsx from "clsx"
import { Collapsible } from "radix-ui"
import { useMemo } from "react"
import { atom, useAtom } from "jotai"
import { IconChevronDown, IconExternalLink } from "@initia/icons-react"
import AsyncBoundary from "@/components/AsyncBoundary"
import FallBack from "@/components/FallBack"
import Image from "@/components/Image"
import {
  buildDenomLogoMap,
  getPositionValue,
  type PortfolioChainPositionGroup,
} from "@/data/minity"
import { usePortfolio } from "@/data/portfolio"
import { formatValue } from "@/lib/format"
import CivitiaSection from "./CivitiaSection"
import PositionSectionList from "./PositionSection"
import styles from "./AppchainPositionGroup.module.css"

const openPositionGroupsAtom = atom<string[]>([])

interface Props {
  chainGroup: PortfolioChainPositionGroup
}

const AppchainPositionGroup = ({ chainGroup }: Props) => {
  const { chainName, chainLogo, protocols } = chainGroup
  const { assetGroups } = usePortfolio()

  // Build denom -> logo map from portfolio asset groups
  const denomLogoMap = useMemo(() => buildDenomLogoMap(assetGroups), [assetGroups])

  // Get the manage URL from first protocol
  const manageUrl = protocols[0]?.manageUrl

  const [openGroups, setOpenGroups] = useAtom(openPositionGroupsAtom)

  // Calculate total value for this chain group
  const totalValue = useMemo(() => {
    return protocols.reduce((sum, protocol) => {
      return sum + protocol.positions.reduce((pSum, pos) => pSum + getPositionValue(pos), 0)
    }, 0)
  }, [protocols])

  const isOpen = openGroups.includes(chainName)

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
              <span className={styles.value}>{formatValue(totalValue)}</span>
              <IconChevronDown
                size={16}
                className={clsx(styles.expandIcon, { [styles.expanded]: isOpen })}
              />
            </div>
          </button>
        </Collapsible.Trigger>

        <Collapsible.Content className={styles.collapsibleContent}>
          <div className={styles.content}>
            <PositionSectionList protocols={protocols} denomLogoMap={denomLogoMap} />
            {chainName?.toLowerCase() === "civitia" && (
              <AsyncBoundary
                suspenseFallback={
                  <div className={styles.fallbackWrapper}>
                    <FallBack height={36} length={2} />
                  </div>
                }
              >
                <CivitiaSection />
              </AsyncBoundary>
            )}
          </div>
        </Collapsible.Content>
      </Collapsible.Root>
    </div>
  )
}

export default AppchainPositionGroup
