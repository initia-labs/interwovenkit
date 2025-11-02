import clsx from "clsx"
import { useState } from "react"
import { useAtom, useSetAtom } from "jotai"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { IconCheckCircle, IconWallet } from "@initia/icons-react"
import { GenericAuthorization } from "@initia/initia.proto/cosmos/authz/v1beta1/authz"
import { BasicAllowance } from "@initia/initia.proto/cosmos/feegrant/v1beta1/feegrant"
import { InitiaAddress, truncate } from "@initia/utils"
import Button from "@/components/Button"
import Dropdown from "@/components/Dropdown"
import Footer from "@/components/Footer"
import Image from "@/components/Image"
import Scrollable from "@/components/Scrollable"
import { useChain, useInitiaRegistry } from "@/data/chains"
import { useConfig } from "@/data/config"
import { useDrawer } from "@/data/ui"
import { useLocationState } from "@/lib/router"
import { useInterwovenKit } from "@/public/data/hooks"
import { useRegisterAutoSign } from "./data/actions"
import { DEFAULT_DURATION, DURATION_OPTIONS } from "./data/constants"
import { useAutoSignPermissions } from "./data/permissions"
import { autoSignQueryKeys } from "./data/queries"
import { autoSignExpirationAtom, pendingAutoSignRequestAtom } from "./data/state"
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
  const { privyContext, defaultChainId } = useConfig()
  const autoSignPermissions = useAutoSignPermissions()
  const embeddedWallet = useEmbeddedWallet()
  const setAutoSignExpiration = useSetAtom(autoSignExpirationAtom)
  const [pendingAutoSignRequest, setPendingAutoSignRequest] = useAtom(pendingAutoSignRequestAtom)
  const registerAutoSign = useRegisterAutoSign()
  const [selectedDuration, setSelectedDuration] = useState<number>(DEFAULT_DURATION)
  const [warningIgnored, setWarningIgnored] = useState(false)
  const { chainId: locationChainId } = useLocationState<AutoSignLocationState>()
  const chainId = locationChainId || defaultChainId
  const chain = useChain(chainId)
  const queryClient = useQueryClient()

  const { icon: dappIcon, name: dappName } = getPageInfo()

  const chains = useInitiaRegistry()
  const trustedWebsites = chains
    .map(({ website }) => {
      try {
        const url = new URL(website || "")
        return url.host.replace("www.", "")
      } catch {
        return null
      }
    })
    .filter((host): host is string => !!host)

  const isTrusted = trustedWebsites.some(
    (host) => window.location.host === host || window.location.host.endsWith(`.${host}`),
  )

  const showWarning = !isTrusted && !warningIgnored

  const { mutate: createAutoSign, isPending } = useMutation({
    mutationFn: async () => {
      if (!privyContext) {
        throw new Error("Privy context is not configured")
      }

      if (!autoSignPermissions?.[chainId]?.length) {
        throw new Error("Auto sign permissions are not configured")
      }

      const { address: embeddedWalletAddress } =
        embeddedWallet || (await privyContext.createWallet({ createAdditional: false }))

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
      setAutoSignExpiration((expirationMap) => ({
        ...expirationMap,
        [chainId]: expiration.getTime(),
      }))

      const queryKeys = [
        autoSignQueryKeys.grantsByGranter(chain.restUrl, initiaAddress).queryKey,
        autoSignQueryKeys.permissions(initiaAddress).queryKey,
      ]

      for (const queryKey of queryKeys) {
        queryClient.invalidateQueries({ queryKey })
      }

      // Resolve the promise if there's a pending request
      pendingAutoSignRequest?.resolve()
      setPendingAutoSignRequest(null)
      closeDrawer()
    },
    onError: (error) => {
      // Reject the promise if there's a pending request
      pendingAutoSignRequest?.reject(error as Error)
      setPendingAutoSignRequest(null)
      closeDrawer()
    },
  })

  const handleReject = () => {
    // Reject the promise if there's a pending request
    pendingAutoSignRequest?.reject(new Error("User rejected auto sign setup"))
    setPendingAutoSignRequest(null)
    closeDrawer()
  }

  const handleConfirm = () => {
    createAutoSign()
  }

  return (
    <>
      <Scrollable>
        <h1 className={styles.title}>Enable auto-signing</h1>
        <h2 className={styles.subtitle}>An application is requesting to enable auto-signing</h2>

        <p className={styles.label}>Requested by</p>
        <div className={clsx(styles.container, styles.appInfo)}>
          {dappIcon ? (
            <img src={dappIcon} alt={dappName} className={styles.icon} width={28} height={28} />
          ) : (
            <div className={styles.iconPlaceholder} />
          )}

          <p className={styles.appName}>{dappName}</p>
          <p className={styles.host}>{window.location.host}</p>
        </div>

        {showWarning && <WebsiteWarning onIgnore={() => setWarningIgnored(true)} />}

        <p className={styles.label}>Applies to</p>

        <div className={clsx(styles.container, styles.details)}>
          <p className={styles.detailLabel}>Address</p>
          <p className={styles.detailValue}>
            <IconWallet size={14} />
            {username ?? truncate(initiaAddress)}
          </p>

          <p className={styles.detailLabel}>Chain</p>
          <p className={styles.detailValue}>
            <Image src={chain.logoUrl} width={14} height={14} logo /> {chain.name}
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
            <li className={styles.listItem} key={text}>
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
        <Button.White onClick={handleConfirm} loading={isPending} disabled={showWarning}>
          Confirm
        </Button.White>
      </Footer>
    </>
  )
}

export default EnableAutoSignPage
