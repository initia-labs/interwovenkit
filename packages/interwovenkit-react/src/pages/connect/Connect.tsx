import clsx from "clsx"
import { descend } from "ramda"
import type { Connector } from "wagmi"
import { useConnect } from "wagmi"
import { useState } from "react"
import { useReadLocalStorage } from "usehooks-ts"
import { useMutation } from "@tanstack/react-query"
import { IconExternalLink } from "@initia/icons-react"
import Image from "@/components/Image"
import Loader from "@/components/Loader"
import Scrollable from "@/components/Scrollable"
import { normalizeError } from "@/data/http"
import { initiaPrivyWalletOptions } from "@/public/data/connectors"
import styles from "./Connect.module.css"

const recommendedWallets = [
  { name: "Rabby", url: "https://rabby.io" },
  { name: "Phantom", url: "https://phantom.com" },
  { name: "Keplr", url: "https://keplr.app" },
  { name: "Leap", url: "https://leapwallet.io" },
]

const Connect = ({ onSuccess }: { onSuccess?: () => void }) => {
  const { connectors, connectAsync } = useConnect()
  const recentConnectorId = useReadLocalStorage<string>("wagmi.recentConnectorId")
  const [pendingConnectorId, setPendingConnectorId] = useState<string | null>(null)

  const { mutate, isPending } = useMutation({
    mutationFn: async (connector: Connector) => {
      setPendingConnectorId(connector.id)
      try {
        await connectAsync({ connector })
      } catch (error) {
        // make sure to disconnect wallet if login fails
        throw await normalizeError(error)
      }
    },
    onSettled: () => {
      setPendingConnectorId(null)
    },
    onSuccess: () => {
      onSuccess?.()
    },
  })

  return (
    <div className={styles.page}>
      <h1 className={styles.title}>Connect wallet</h1>

      <Scrollable className={styles.scrollable}>
        <div className={styles.list}>
          {connectors
            .toSorted(descend((connector) => connector.id === recentConnectorId))
            .map((connector) => {
              const { name, icon, id } = connector
              return (
                <button
                  className={styles.item}
                  onClick={() => mutate(connector)}
                  disabled={isPending}
                  key={id}
                >
                  <Image src={icon} width={24} height={24} />
                  <span className={styles.name}>{name}</span>
                  {pendingConnectorId === id ? (
                    <Loader size={16} />
                  ) : recentConnectorId === id ? (
                    <span className={styles.recent}>Recent</span>
                  ) : connector.id === initiaPrivyWalletOptions.id ? null : (
                    <span className={styles.installed}>Installed</span>
                  )}
                </button>
              )
            })}

          {recommendedWallets
            .filter(({ name }) => !connectors.some((connector) => connector.name.includes(name)))
            .map(({ name, url }) => {
              const imageUrl = `https://assets.initia.xyz/images/wallets/${name}.webp`
              return (
                <a href={url} className={styles.item} target="_blank" key={name}>
                  <Image src={imageUrl} width={24} height={24} />
                  <span className={clsx(styles.name, styles.dimmed)}>{name}</span>
                  <IconExternalLink size={10} />
                </a>
              )
            })}
        </div>
      </Scrollable>
    </div>
  )
}

export default Connect
