import { useState } from "react"
import clsx from "clsx"
import { useAtomValue, useSetAtom } from "jotai"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { IconCheckCircle, IconWallet } from "@initia/icons-react"
import { BasicAllowance } from "@initia/initia.proto/cosmos/feegrant/v1beta1/feegrant"
import { GenericAuthorization } from "@initia/initia.proto/cosmos/authz/v1beta1/authz"
import { InitiaAddress, truncate } from "@initia/utils"
import { useLocationState } from "@/lib/router"
import { useDrawer } from "@/data/ui"
import { useConfig } from "@/data/config"
import { useInterwovenKit, ghostWalletRequestHandlerAtom } from "@/public/data/hooks"
import Button from "@/components/Button"
import Modal from "@/components/Modal"
import DurationSelector from "./DurationSelector"
import { useEmbeddedWallet, ghostWalletExpirationAtom } from "./hooks"
import { ghostWalletQueryKeys } from "./queries"
import styles from "./CreateGhostWalletPage.module.css"
import { useChain } from "@/data/chains"
import { DEFAULT_DURATION } from "./constants"

interface GhostWalletLocationState {
  chainId?: string
}

const CreateGhostWalletPage = () => {
  const { closeDrawer } = useDrawer()
  const { initiaAddress, username, requestTxBlock } = useInterwovenKit()
  const config = useConfig()
  const embeddedWallet = useEmbeddedWallet()
  const setGhostWalletExpiration = useSetAtom(ghostWalletExpirationAtom)
  const ghostWalletRequestHandler = useAtomValue(ghostWalletRequestHandlerAtom)
  const setGhostWalletRequestHandler = useSetAtom(ghostWalletRequestHandlerAtom)
  const [selectedDuration, setSelectedDuration] = useState<number>(DEFAULT_DURATION)
  const { chainId: locationChainId } = useLocationState<GhostWalletLocationState>()
  const chainId = locationChainId || config.defaultChainId
  const chain = useChain(chainId)
  const queryClient = useQueryClient()

  const appIcon = (document.querySelector("link[rel~='icon']") as HTMLLinkElement | null)?.href

  const { mutate: createGhostWallet, isPending } = useMutation({
    mutationFn: async () => {
      if (!config.privy) {
        throw new Error("Privy hooks must be configured")
      }

      if (!config.ghostWalletPermissions?.[chainId]?.length) {
        throw new Error("Ghost wallet permissions must be configured")
      }

      const { address: ghostWalletAddress } =
        embeddedWallet || (await config.privy.createWallet({ createAdditional: false }))

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
              value: BasicAllowance.encode(BasicAllowance.fromPartial({ expiration })).finish(),
            },
          },
        },
        ...config.ghostWalletPermissions[chainId].map((msg) => ({
          typeUrl: "/cosmos.authz.v1beta1.MsgGrant",
          value: {
            granter: initiaAddress,
            grantee: InitiaAddress(ghostWalletAddress).bech32,
            grant: {
              authorization: {
                typeUrl: "/cosmos.authz.v1beta1.GenericAuthorization",
                value: GenericAuthorization.encode({ msg }).finish(),
              },
              expiration,
            },
          },
        })),
      ]

      await requestTxBlock({ messages, chainId })
      return expiration
    },
    onSuccess: (expiration) => {
      setGhostWalletExpiration((exp) => ({ ...exp, [chainId]: expiration.getTime() }))
      // Invalidate grants queries to refresh the data
      queryClient.invalidateQueries({
        queryKey: ghostWalletQueryKeys.grantsByGranter(chain.restUrl, initiaAddress).queryKey,
      })
      // Resolve the promise if there's a pending request
      ghostWalletRequestHandler?.resolve()
      setGhostWalletRequestHandler(null)
      closeDrawer()
    },
    onError: (error) => {
      // Reject the promise if there's a pending request
      ghostWalletRequestHandler?.reject(error as Error)
      setGhostWalletRequestHandler(null)
      closeDrawer()
    },
  })

  const handleReject = () => {
    // Reject the promise if there's a pending request
    ghostWalletRequestHandler?.reject(new Error("User rejected ghost wallet creation"))
    setGhostWalletRequestHandler(null)
    closeDrawer()
  }

  const handleConfirm = () => {
    createGhostWallet()
  }

  return (
    <Modal open={true} onOpenChange={() => {}}>
      <div className={styles.content}>
        <h1 className={styles.title}>Enable auto-signing</h1>
        <h2 className={styles.subtitle}>An application is requesting to enable auto-signing.</h2>

        <p className={styles.label}>Requested by</p>
        <div className={clsx(styles.container, styles.appInfo)}>
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

        <p className={styles.label}>Applies to</p>

        <div className={clsx(styles.container, styles.details)}>
          <p className={styles.detailLabel}>Address</p>
          <p className={styles.detailValue}>
            <IconWallet size={14} />
            {username ?? truncate(initiaAddress)}
          </p>

          <p className={styles.detailLabel}>Chain</p>
          <p className={styles.detailValue}>
            <img src={chain?.logoUrl} alt={chain?.name} width={14} height={14} /> {chain?.name}
          </p>

          <p className={styles.detailLabel}>Duration</p>
          <div className={styles.detailValue}>
            <DurationSelector
              value={selectedDuration}
              onChange={setSelectedDuration}
              disabled={isPending}
            />
          </div>
        </div>

        <p className={styles.label}>About auto-signing</p>

        <ul className={styles.list}>
          {[
            "Send transactions without confirmation pop-ups",
            "Protected by Privy embedded wallet",
            "Revoke permissions any time in settings",
          ].map((text) => (
            <li className={styles.listItem}>
              <IconCheckCircle size={12} />
              <span>{text}</span>
            </li>
          ))}
        </ul>

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

export default CreateGhostWalletPage
