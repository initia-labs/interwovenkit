import clsx from "clsx"
import type { Connector } from "wagmi"
import { useMemo, useState } from "react"
import { IconBack, IconExternalLink } from "@initia/icons-react"
import FormHelp from "@/components/form/FormHelp"
import SearchInput from "@/components/form/SearchInput"
import Image from "@/components/Image"
import Loader from "@/components/Loader"
import Scrollable from "@/components/Scrollable"
import { normalizeWalletName } from "./normalizeWalletName"
import { useWalletConnectWallets } from "./useWalletConnectWallets"
import styles from "./Connect.module.css"

const isSafeHttpsUrl = (url: string): boolean => {
  try {
    const u = new URL(url.trim())
    return u.protocol === "https:" && !u.username && !u.password
  } catch {
    return false
  }
}

interface Props {
  walletConnectors: Connector[]
  isPending: boolean
  pendingConnectorId: string | null
  recentConnectorId: string | null
  onConnect: (connector: Connector) => void
  onBack: () => void
}

const AllWallets = ({
  walletConnectors,
  isPending,
  pendingConnectorId,
  recentConnectorId,
  onConnect,
  onBack,
}: Props) => {
  const [search, setSearch] = useState("")
  const {
    data: wcWallets = [],
    isError: isWalletConnectWalletsError,
    isLoading: isWalletConnectWalletsLoading,
    isFetching: isWalletConnectWalletsFetching,
  } = useWalletConnectWallets()
  const showWalletConnectLoading =
    isWalletConnectWalletsLoading || (isWalletConnectWalletsFetching && wcWallets.length === 0)

  const filteredConnectors = useMemo(() => {
    if (!search) return walletConnectors
    const searchLower = search.toLowerCase()
    return walletConnectors.filter((c) => c.name.toLowerCase().includes(searchLower))
  }, [walletConnectors, search])

  const additionalWallets = useMemo(() => {
    const connectorNamesNormalized = new Set(
      walletConnectors.map((c) => normalizeWalletName(c.name)),
    )
    const searchLower = search.toLowerCase()

    return wcWallets
      .filter((w) => !connectorNamesNormalized.has(normalizeWalletName(w.name)))
      .filter((w) => !search || w.name.toLowerCase().includes(searchLower))
      .sort((a, b) => a.name.localeCompare(b.name))
  }, [wcWallets, walletConnectors, search])

  return (
    <div className={styles.pageTop}>
      <button type="button" className={styles.backButtonFixed} onClick={onBack} aria-label="Back">
        <IconBack size={16} aria-hidden="true" />
      </button>

      <header className={styles.header}>
        <div className={styles.headerSpacer} />
        <h1 className={styles.title}>All Wallets</h1>
        <div className={styles.headerSpacer} />
      </header>

      <div className={styles.searchWrapper}>
        <SearchInput
          rootClassName={styles.searchInputUnderline}
          placeholder="Search Wallet"
          aria-label="Search wallets"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          onClear={() => setSearch("")}
        />
      </div>

      <Scrollable className={styles.scrollable}>
        <div className={styles.list}>
          {filteredConnectors.map((connector) => {
            const { name, icon, id } = connector
            const isRecent = recentConnectorId === id
            const isPendingConnection = pendingConnectorId === id
            const isReady = "ready" in connector ? Boolean(connector.ready) : true

            return (
              <button
                type="button"
                className={clsx(styles.listItem, { [styles.loading]: isPendingConnection })}
                onClick={() => onConnect(connector)}
                disabled={isPending || !isReady}
                aria-busy={isPendingConnection}
                key={`connector:${id}`}
              >
                <div className={styles.listIconWrapper}>
                  <Image src={icon} width={26} height={26} alt="" className={styles.icon} />
                </div>
                <span className={styles.listName}>{name}</span>
                {isPendingConnection ? (
                  <Loader size={16} />
                ) : isRecent ? (
                  <span className={styles.recentBadge}>Recent</span>
                ) : isReady ? (
                  <span className={styles.installedText}>Installed</span>
                ) : null}
              </button>
            )
          })}

          {showWalletConnectLoading && (
            <div className={clsx(styles.listItem, styles.loading)} role="status" aria-live="polite">
              <div className={styles.listIconWrapper}>
                <Loader size={16} />
              </div>
              <span className={styles.listNameMuted}>Loading more wallets...</span>
            </div>
          )}

          {additionalWallets.map((wallet) => {
            const href = wallet.homepage
            const iconSrc = wallet.image_url?.sm || wallet.image_url?.md || wallet.image_url?.lg
            const safeIconSrc = iconSrc && isSafeHttpsUrl(iconSrc) ? iconSrc : undefined

            if (!href || !isSafeHttpsUrl(href)) return null

            return (
              <a
                className={styles.listItem}
                href={href}
                target="_blank"
                rel="noopener noreferrer"
                aria-label={`${wallet.name} (opens in new tab)`}
                key={`wc:${wallet.id}`}
              >
                <div className={styles.listIconWrapper}>
                  {safeIconSrc && (
                    <Image
                      src={safeIconSrc}
                      width={26}
                      height={26}
                      alt=""
                      className={styles.icon}
                    />
                  )}
                </div>
                <span className={styles.listNameMuted}>{wallet.name}</span>
                <IconExternalLink
                  size={10}
                  className={styles.externalLinkIcon}
                  aria-hidden="true"
                />
              </a>
            )
          })}

          {isWalletConnectWalletsError && (
            <FormHelp level="error">Couldn&apos;t load additional wallets.</FormHelp>
          )}
        </div>
      </Scrollable>
    </div>
  )
}

export default AllWallets
