import clsx from "clsx"
import type { Connector } from "wagmi"
import { useMemo, useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { IconChevronLeft } from "@initia/icons-react"
import SearchInput from "@/components/form/SearchInput"
import Image from "@/components/Image"
import Loader from "@/components/Loader"
import Scrollable from "@/components/Scrollable"
import type { WalletInfo } from "./Connect"
import styles from "./Connect.module.css"

const WALLETCONNECT_PROJECT_ID = "5722e7dffb709492cf5312446ceeff73"
const WALLETCONNECT_API = `https://explorer-api.walletconnect.com/v3/wallets?projectId=${WALLETCONNECT_PROJECT_ID}`

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

  const { data: wcWallets = [] } = useQuery({
    queryKey: ["walletconnect-wallets"],
    queryFn: async () => {
      const response = await fetch(WALLETCONNECT_API)
      if (!response.ok) {
        throw new Error(`Failed to fetch wallets: ${response.status}`)
      }
      const data = await response.json()
      const wallets: WalletInfo[] = Object.values(data.listings || data || {})
      return wallets
    },
    staleTime: 1000 * 60 * 60,
    retry: 2,
  })

  const filteredConnectors = useMemo(() => {
    let result = [...walletConnectors]

    if (search) {
      const searchLower = search.toLowerCase()
      result = result.filter((c) => c.name.toLowerCase().includes(searchLower))
    }

    return result.sort((a, b) => {
      if (a.id === recentConnectorId) return -1
      if (b.id === recentConnectorId) return 1
      return a.name.localeCompare(b.name)
    })
  }, [walletConnectors, search, recentConnectorId])

  const additionalWallets = useMemo(() => {
    const connectorNames = new Set(walletConnectors.map((c) => c.name.toLowerCase()))
    let filtered = wcWallets.filter((w) => !connectorNames.has(w.name.toLowerCase()))

    if (search) {
      const searchLower = search.toLowerCase()
      filtered = filtered.filter((w) => w.name.toLowerCase().includes(searchLower))
    }

    return filtered.sort((a, b) => a.name.localeCompare(b.name))
  }, [wcWallets, walletConnectors, search])

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <button className={styles.backButton} onClick={onBack}>
          <IconChevronLeft size={20} />
        </button>
        <h1 className={styles.title}>All wallets</h1>
        <div className={styles.headerSpacer} />
      </header>

      <div className={styles.searchWrapper}>
        <SearchInput
          rootClassName={styles.searchInput}
          placeholder="Search wallets"
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

            return (
              <button
                className={clsx(styles.listItem, { [styles.loading]: isPendingConnection })}
                onClick={() => onConnect(connector)}
                disabled={isPending}
                key={id}
              >
                <div className={styles.listIconWrapper}>
                  <Image src={icon} width={32} height={32} className={styles.icon} />
                  <span className={styles.installedDot} />
                </div>
                <span className={styles.listName}>{name}</span>
                {isPendingConnection ? (
                  <Loader size={16} />
                ) : isRecent ? (
                  <span className={styles.recentBadge}>Recent</span>
                ) : null}
              </button>
            )
          })}

          {additionalWallets.map((wallet) => (
            <a
              className={styles.listItem}
              href={wallet.homepage}
              target="_blank"
              rel="noopener noreferrer"
              key={wallet.id}
            >
              <div className={styles.listIconWrapper}>
                <Image src={wallet.image_url.sm} width={32} height={32} className={styles.icon} />
              </div>
              <span className={styles.listName}>{wallet.name}</span>
            </a>
          ))}
        </div>
      </Scrollable>
    </div>
  )
}

export default AllWallets
