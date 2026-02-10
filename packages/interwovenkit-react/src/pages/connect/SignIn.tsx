import clsx from "clsx"
import type { Connector } from "wagmi"
import { IconExternalLink } from "@initia/icons-react"
import Image from "@/components/Image"
import Loader from "@/components/Loader"
import styles from "./Connect.module.css"

const MoreDotsIcon = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
    <circle cx="4" cy="8" r="1.5" />
    <circle cx="8" cy="8" r="1.5" />
    <circle cx="12" cy="8" r="1.5" />
  </svg>
)

const GoogleIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true">
    <path
      fill="#4285F4"
      d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
    />
    <path
      fill="#34A853"
      d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
    />
    <path
      fill="#FBBC05"
      d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
    />
    <path
      fill="#EA4335"
      d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
    />
  </svg>
)

const XIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
    <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
  </svg>
)

const EmailIcon = () => (
  <svg
    width="20"
    height="20"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    aria-hidden="true"
  >
    <rect x="2" y="4" width="20" height="16" rx="2" />
    <path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7" />
  </svg>
)

const POPULAR_WALLETS = [
  {
    id: "io.rabby",
    name: "Rabby",
    icon: "https://assets.initia.xyz/images/wallets/Rabby.webp",
    url: "https://rabby.io",
  },
  {
    id: "app.phantom",
    name: "Phantom",
    icon: "https://assets.initia.xyz/images/wallets/Phantom.webp",
    url: "https://phantom.com",
  },
  {
    id: "app.keplr",
    name: "Keplr",
    icon: "https://assets.initia.xyz/images/wallets/Keplr.webp",
    url: "https://keplr.app",
  },
  {
    id: "io.leapwallet",
    name: "Leap",
    icon: "https://assets.initia.xyz/images/wallets/Leap.webp",
    url: "https://leapwallet.io",
  },
  {
    id: "io.metamask",
    name: "MetaMask",
    icon: "https://assets.initia.xyz/images/wallets/MetaMask.webp",
    url: "https://metamask.io",
  },
]

interface Props {
  walletConnectors: Connector[]
  privyConnector: Connector | undefined
  isPending: boolean
  pendingConnectorId: string | null
  recentConnectorId: string | null
  onConnect: (connector: Connector) => void
  onShowAll: () => void
  onPrefetchWallets: () => void
}

const SignIn = ({
  walletConnectors,
  privyConnector,
  isPending,
  pendingConnectorId,
  recentConnectorId,
  onConnect,
  onShowAll,
  onPrefetchWallets,
}: Props) => {
  const readyConnectors = walletConnectors.filter((c) => !("ready" in c) || Boolean(c.ready))
  const suggestedWallets = readyConnectors.slice(0, 5)
  const readyConnectorIds = new Set(readyConnectors.map((c) => c.id))

  const slotsToFill = Math.max(0, 5 - suggestedWallets.length)
  const popularToShow = POPULAR_WALLETS.filter((w) => !readyConnectorIds.has(w.id)).slice(
    0,
    slotsToFill,
  )

  return (
    <div className={styles.page}>
      <div className={styles.pageContent}>
        <header className={styles.header}>
          <div className={styles.headerSpacer} />
          <h1 className={styles.title}>Sign In</h1>
          <div className={styles.headerSpacer} />
        </header>

        {privyConnector && (
          <>
            <button
              type="button"
              className={clsx(styles.socialButton, {
                [styles.loading]: pendingConnectorId === privyConnector.id,
              })}
              onClick={() => onConnect(privyConnector)}
              disabled={isPending}
              aria-busy={pendingConnectorId === privyConnector.id}
            >
              <span className={styles.socialText}>Email / Socials</span>
              {pendingConnectorId === privyConnector.id ? (
                <Loader size={16} />
              ) : (
                <div className={styles.socialIcons}>
                  <GoogleIcon />
                  <EmailIcon />
                  <XIcon />
                </div>
              )}
            </button>

            <div className={styles.divider}>
              <span className={styles.dividerText}>or</span>
            </div>
          </>
        )}

        <div className={styles.list}>
          {suggestedWallets.map((connector) => {
            const { name, icon, id } = connector
            const isPendingConnection = pendingConnectorId === id
            const isRecent = recentConnectorId === id

            return (
              <button
                type="button"
                className={clsx(styles.listItem, { [styles.loading]: isPendingConnection })}
                onClick={() => onConnect(connector)}
                disabled={isPending}
                aria-busy={isPendingConnection}
                key={id}
              >
                <div className={styles.listIconWrapper}>
                  <Image src={icon} width={26} height={26} alt="" className={styles.icon} />
                </div>
                <span className={styles.listName}>{name}</span>
                {isPendingConnection ? (
                  <Loader size={16} />
                ) : isRecent ? (
                  <span className={styles.recentBadge}>Recent</span>
                ) : (
                  <span className={styles.installedText}>Installed</span>
                )}
              </button>
            )
          })}

          {popularToShow.map((wallet) => (
            <a
              className={styles.listItem}
              href={wallet.url}
              target="_blank"
              rel="noopener noreferrer"
              aria-label={`${wallet.name} (opens in new tab)`}
              key={wallet.id}
            >
              <div className={styles.listIconWrapper}>
                <Image src={wallet.icon} width={26} height={26} alt="" className={styles.icon} />
              </div>
              <span className={styles.listNameMuted}>{wallet.name}</span>
              <IconExternalLink size={10} className={styles.externalLinkIcon} aria-hidden="true" />
            </a>
          ))}

          <button
            type="button"
            className={styles.listItem}
            onClick={onShowAll}
            onMouseEnter={onPrefetchWallets}
            onFocus={onPrefetchWallets}
            disabled={isPending}
          >
            <div className={styles.listIconWrapper}>
              <div className={styles.moreIconSmall}>
                <MoreDotsIcon />
              </div>
            </div>
            <span className={styles.listNameMuted}>More wallets</span>
            <span className={styles.arrowIcon} aria-hidden="true">
              →
            </span>
          </button>
        </div>
      </div>

      <div className={styles.spacer} />

      <a
        className={styles.learnMoreLink}
        href="https://docs.initia.xyz/home/tools/wallet"
        target="_blank"
        rel="noopener noreferrer"
        aria-label="Learn more (opens in new tab)"
      >
        Learn more
        <IconExternalLink size={14} aria-hidden="true" />
      </a>
    </div>
  )
}

export default SignIn
