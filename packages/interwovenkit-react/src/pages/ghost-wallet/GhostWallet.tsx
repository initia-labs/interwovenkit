import { IconCheckCircle } from "@initia/icons-react"
import { useMutation } from "@tanstack/react-query"
import { useState } from "react"
import { useDrawer } from "@/data/ui"
import Button from "@/components/Button"
import styles from "./GhostWallet.module.css"
import { BasicAllowance } from "@initia/initia.proto/cosmos/feegrant/v1beta1/feegrant"
import { GenericAuthorization } from "@initia/initia.proto/cosmos/authz/v1beta1/authz"
import { useInterwovenKit } from "@/public/data/hooks"
import { useConfig } from "@/data/config"
import { InitiaAddress, truncate } from "@initia/utils"
import { useEmbeddedWallet, ghostWalletExpirationAtom } from "./hooks"
import { useSetAtom } from "jotai"
import DurationSelector from "./DurationSelector"
import Modal from "@/components/Modal"

const DEFAULT_DURATION = 10 * 60 * 1000

const GhostWallet = () => {
  const { closeDrawer } = useDrawer()
  const { initiaAddress, requestTxSync } = useInterwovenKit()
  const config = useConfig()
  const embeddedWallet = useEmbeddedWallet()
  const setGhostWalletExpiration = useSetAtom(ghostWalletExpirationAtom)
  const [selectedDuration, setSelectedDuration] = useState<number>(DEFAULT_DURATION)

  const appIcon = (document.querySelector("link[rel~='icon']") as HTMLLinkElement | null)?.href

  const { mutate: createGhostWallet, isPending } = useMutation({
    mutationFn: async () => {
      if (!config.privyHooks) {
        throw new Error("Privy hooks must be configured")
      }

      if (!config.ghostWalletPermissions?.length) {
        throw new Error("Ghost wallet permissions must be configured")
      }

      const { address: ghostWalletAddress } =
        embeddedWallet || (await config.privyHooks.createWallet({ createAdditional: false }))

      const selectedDurationMs = selectedDuration
      const expiration = new Date(Date.now() + selectedDurationMs)

      const messages = [
        {
          typeUrl: "/cosmos.feegrant.v1beta1.MsgGrantAllowance",
          value: {
            granter: initiaAddress,
            grantee: InitiaAddress(ghostWalletAddress).bech32,
            allowance: {
              typeUrl: "/cosmos.feegrant.v1beta1.BasicAllowance",
              value: BasicAllowance.encode(
                BasicAllowance.fromPartial({
                  expiration,
                }),
              ).finish(),
            },
          },
        },
        ...config.ghostWalletPermissions.map((typeUrl) => ({
          typeUrl: "/cosmos.authz.v1beta1.MsgGrant",
          value: {
            granter: initiaAddress,
            grantee: InitiaAddress(ghostWalletAddress).bech32,
            grant: {
              authorization: {
                typeUrl: "/cosmos.authz.v1beta1.GenericAuthorization",
                value: GenericAuthorization.encode({
                  msg: typeUrl,
                }).finish(),
              },
              expiration,
            },
          },
        })),
      ]

      return await requestTxSync({
        messages,
      })
    },
    onSuccess: () => {
      // Set the ghost wallet expiration atom based on selected duration
      const selectedDurationMs = selectedDuration

      setGhostWalletExpiration(Date.now() + selectedDurationMs)

      closeDrawer()
    },
  })

  const handleReject = () => {
    closeDrawer()
  }

  const handleConfirm = () => {
    createGhostWallet()
  }

  return (
    <Modal open={true} onOpenChange={() => {}}>
      <div className={styles.content}>
        <h1 className={styles.title}>Enable auto-signing</h1>

        <p className={styles.description}>Asking for permission</p>
        <div className={styles.appInfoContainer}>
          {appIcon ? (
            <img
              src={appIcon}
              alt={document.title}
              className={styles.icon}
              width={28}
              height={28}
            />
          ) : (
            <div className={styles.iconPlaceholder} />
          )}

          <p className={styles.appName}>{document.title}</p>
          <p className={styles.host}>{window.location.host}</p>
        </div>

        <div className={styles.descriptionContainer}>
          <p className={styles.descriptionLabel}>Address</p>
          <p className={styles.descriptionValue}>{truncate(initiaAddress)}</p>

          <p className={styles.descriptionLabel}>Chain</p>
          <p className={styles.descriptionValue}>{config.defaultChainId}</p>
        </div>

        <ul className={styles.list}>
          {[
            "Automatic transaction signing",
            "Enables faster interactions",
            "Can be disabled at any time",
            "Secured by Privy",
          ].map((text) => (
            <li className={styles.listItem}>
              <IconCheckCircle size={12} />
              <span>{text}</span>
            </li>
          ))}
        </ul>

        <div className={styles.durationSelector}>
          <span className={styles.durationLabel}>Set duration</span>
          <DurationSelector
            value={selectedDuration}
            onChange={setSelectedDuration}
            disabled={isPending}
            fullWidth
          />
        </div>

        <footer className={styles.footer}>
          <Button.Outline onClick={handleReject} disabled={isPending}>
            Reject
          </Button.Outline>
          <Button.White onClick={handleConfirm} loading={isPending}>
            Confirm
          </Button.White>
        </footer>
      </div>
    </Modal>
  )
}

export default GhostWallet
