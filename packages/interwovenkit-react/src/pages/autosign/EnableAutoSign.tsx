import clsx from "clsx"
import { useState } from "react"
import { useSetAtom } from "jotai"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { IconCheckCircle, IconWallet } from "@initia/icons-react"
import { GenericAuthorization } from "@initia/initia.proto/cosmos/authz/v1beta1/authz"
import { BasicAllowance } from "@initia/initia.proto/cosmos/feegrant/v1beta1/feegrant"
import { InitiaAddress, truncate } from "@initia/utils"
import Button from "@/components/Button"
import Dropdown from "@/components/Dropdown"
import Footer from "@/components/Footer"
import Scrollable from "@/components/Scrollable"
import { useChain } from "@/data/chains"
import { useConfig } from "@/data/config"
import { useDrawer } from "@/data/ui"
import { useLocationState } from "@/lib/router"
import { useInterwovenKit } from "@/public/data/hooks"
import { useRegisterAutoSign } from "./data/actions"
import { DEFAULT_DURATION, DURATION_OPTIONS } from "./data/constants"
import { useAutoSignPermissions } from "./data/permissions"
import { autoSignQueryKeys } from "./data/queries"
import {
  autoSignExpirationAtom,
  useAutoSignRequestHandler,
  useSetAutoSignRequestHandler,
} from "./data/state"
import { getPageInfo } from "./data/utils"
import { useEmbeddedWallet } from "./data/wallet"
import WebsiteWarning from "./WebsiteWarning"
import styles from "./EnableAutoSign.module.css"

interface AutoSignLocationState {
  chainId?: string
}

const EnableAutoSignPage = () => {
  const { closeDrawer } = useDrawer()
  const { initiaAddress, username, requestTxBlock } = useInterwovenKit()
  const config = useConfig()
  const autoSignPermissions = useAutoSignPermissions()
  const embeddedWallet = useEmbeddedWallet()
  const setAutoSignExpiration = useSetAtom(autoSignExpirationAtom)
  const autoSignRequestHandler = useAutoSignRequestHandler()
  const setAutoSignRequestHandler = useSetAutoSignRequestHandler()
  const registerAutoSign = useRegisterAutoSign()
  const [selectedDuration, setSelectedDuration] = useState<number>(DEFAULT_DURATION)
  const { chainId: locationChainId } = useLocationState<AutoSignLocationState>()
  const chainId = locationChainId || config.defaultChainId
  const chain = useChain(chainId)
  const queryClient = useQueryClient()

  const { icon: appIcon, name: appName } = getPageInfo()

  const { mutate: createAutoSign, isPending } = useMutation({
    mutationFn: async () => {
      if (!config.privy) {
        throw new Error("Privy hooks must be configured")
      }

      if (!autoSignPermissions?.[chainId]?.length) {
        throw new Error("Auto sign permissions must be configured")
      }

      const { address: embeddedWalletAddress } =
        embeddedWallet || (await config.privy.createWallet({ createAdditional: false }))

      const expiration = new Date(Date.now() + selectedDuration)

      const messages = [
        {
          typeUrl: "/cosmos.feegrant.v1beta1.MsgGrantAllowance",
          value: {
            granter: initiaAddress,
            grantee: InitiaAddress(embeddedWalletAddress).bech32,
            allowance: {
              typeUrl: "/cosmos.feegrant.v1beta1.BasicAllowance",
              value: BasicAllowance.encode(BasicAllowance.fromPartial({ expiration })).finish(),
            },
          },
        },
        ...autoSignPermissions[chainId].map((msg) => ({
          typeUrl: "/cosmos.authz.v1beta1.MsgGrant",
          value: {
            granter: initiaAddress,
            grantee: InitiaAddress(embeddedWalletAddress).bech32,
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
      await registerAutoSign()

      await requestTxBlock({ messages, chainId, internal: "/autosign/enable" })
      return expiration
    },
    onSuccess: (expiration) => {
      setAutoSignExpiration((exp) => ({ ...exp, [chainId]: expiration.getTime() }))
      // Invalidate grants queries to refresh the data
      queryClient.invalidateQueries({
        queryKey: autoSignQueryKeys.grantsByGranter(chain.restUrl, initiaAddress).queryKey,
      })
      // Invalidate permissions query to refresh domain data
      queryClient.invalidateQueries({
        queryKey: autoSignQueryKeys.permissions(initiaAddress).queryKey,
      })
      // Resolve the promise if there's a pending request
      autoSignRequestHandler?.resolve()
      setAutoSignRequestHandler(null)
      closeDrawer()
    },
    onError: (error) => {
      // Reject the promise if there's a pending request
      autoSignRequestHandler?.reject(error as Error)
      setAutoSignRequestHandler(null)
      closeDrawer()
    },
  })

  const handleReject = () => {
    // Reject the promise if there's a pending request
    autoSignRequestHandler?.reject(new Error("User rejected auto sign setup"))
    setAutoSignRequestHandler(null)
    closeDrawer()
  }

  const handleConfirm = () => {
    createAutoSign()
  }

  return (
    <>
      <Scrollable>
        <h1 className={styles.title}>Enable auto-signing</h1>
        <h2 className={styles.subtitle}>An application is requesting to enable auto-signing.</h2>

        <p className={styles.label}>Requested by</p>
        <div className={clsx(styles.container, styles.appInfo)}>
          {appIcon ? (
            <img src={appIcon} alt={appName} className={styles.icon} width={28} height={28} />
          ) : (
            <div className={styles.iconPlaceholder} />
          )}

          <p className={styles.appName}>{appName}</p>
          <p className={styles.host}>{window.location.host}</p>
        </div>

        <WebsiteWarning />

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
            <Dropdown
              options={DURATION_OPTIONS}
              value={selectedDuration}
              onChange={setSelectedDuration}
              classNames={{ trigger: styles.trigger, item: styles.item }}
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
      </Scrollable>

      <Footer className={styles.footer}>
        <Button.Outline onClick={handleReject} disabled={isPending}>
          Reject
        </Button.Outline>
        <Button.White onClick={handleConfirm} loading={isPending}>
          Confirm
        </Button.White>
      </Footer>
    </>
  )
}

export default EnableAutoSignPage
