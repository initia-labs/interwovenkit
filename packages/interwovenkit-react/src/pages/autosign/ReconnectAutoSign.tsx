import { formatDuration, intervalToDuration } from "date-fns"
import { useEffect, useRef, useState } from "react"
import Button from "@/components/Button"
import Dropdown from "@/components/Dropdown"
import Footer from "@/components/Footer"
import FormHelp from "@/components/form/FormHelp"
import Image from "@/components/Image"
import Scrollable from "@/components/Scrollable"
import { useFindChain } from "@/data/chains"
import { useConfig } from "@/data/config"
import { useDrawer } from "@/data/ui"
import { useLocationState } from "@/lib/router"
import { useInitiaAddress } from "@/public/data/hooks"
import { useRenewAutoSign } from "./data/actions"
import { DURATION_OPTIONS } from "./data/constants"
import type { AutoSignPublicIdentity } from "./data/storage"
import {
  shouldRememberRandomReplacement,
  useAutoSignPreference,
  useDeriveWallet,
} from "./data/wallet"
import enableStyles from "./EnableAutoSign.module.css"
import styles from "./ReconnectAutoSign.module.css"

const FINITE_DURATION_OPTIONS = DURATION_OPTIONS.filter((option) => option.value > 0)

interface RecoveryIdentityState {
  scope?: string
  identity?: AutoSignPublicIdentity
  hasWallet: boolean
}

const ReconnectAutoSign = () => {
  const state = useLocationState<{ chainId?: string; durationInMs?: number }>()
  const { autoSignStorage, defaultChainId } = useConfig()
  const owner = useInitiaAddress()
  const chainId = state.chainId ?? defaultChainId
  const hasKnownDuration = state.durationInMs !== undefined && state.durationInMs >= 0
  const [durationInMs, setDurationInMs] = useState(
    hasKnownDuration ? state.durationInMs! : FINITE_DURATION_OPTIONS[0]!.value,
  )
  const { stayConnected, isLoadingPreference, isStorageUnavailable } = useAutoSignPreference(
    chainId,
    owner,
  )
  const wallet = useDeriveWallet()
  const walletRef = useRef(wallet)
  const identityScope = JSON.stringify([owner, chainId])
  const [identityState, setIdentityState] = useState<RecoveryIdentityState>({ hasWallet: false })
  const isLoadingIdentity = identityState.scope !== identityScope
  const recoveryIdentity = isLoadingIdentity ? undefined : identityState.identity
  const hasWallet = !isLoadingIdentity && identityState.hasWallet
  const [error, setError] = useState("")
  const displayedError =
    error ||
    (isStorageUnavailable
      ? "Browser storage is unavailable. Restore browser storage access to reconnect autosign."
      : "")

  const chain = useFindChain()(chainId)
  const { closeDrawer } = useDrawer()
  const renew = useRenewAutoSign()
  const needsRememberedReplacement =
    !isLoadingIdentity &&
    shouldRememberRandomReplacement({
      identity: recoveryIdentity,
      owner,
      chainId,
      hasWallet,
      stayConnected,
      autoSignStorage,
    })

  useEffect(() => {
    walletRef.current = wallet
  }, [wallet])

  useEffect(() => {
    let active = true
    Promise.allSettled([
      walletRef.current.restoreWallet(chainId),
      walletRef.current.getWalletIdentities(chainId),
    ]).then(([restored, identities]) => {
      if (!active) return
      const matchingIdentities =
        identities.status === "fulfilled"
          ? identities.value.filter(
              (identity) => identity.owner === owner && identity.chainId === chainId,
            )
          : []
      setIdentityState({
        scope: identityScope,
        hasWallet:
          restored.status === "fulfilled" &&
          (!!restored.value || !!walletRef.current.getWallet(chainId)),
        identity: matchingIdentities.find((identity) => identity.state === "active"),
      })
    })
    return () => {
      active = false
    }
  }, [chainId, identityScope, owner])

  const handleReconnect = async () => {
    setError("")
    try {
      await renew.mutateAsync({
        chainId,
        durationInMs,
        stayConnected: needsRememberedReplacement ? true : stayConnected,
      })
      closeDrawer()
    } catch (renewError) {
      setError(renewError instanceof Error ? renewError.message : "Unable to reconnect autosign.")
    }
  }

  const configuredDuration = DURATION_OPTIONS.find((option) => option.value === durationInMs)?.label
  const durationLabel =
    configuredDuration ??
    `for ${formatDuration(intervalToDuration({ start: 0, end: durationInMs }))}`

  return (
    <>
      <Scrollable className={enableStyles.container}>
        <header>
          <h1 className={enableStyles.title}>Reconnect autosign</h1>
          <p className={enableStyles.description}>
            {needsRememberedReplacement
              ? "This autosign key can’t be recovered. Remember a replacement on this browser to reconnect your expired permission."
              : "Your autosign permission expired."}
          </p>
        </header>

        <section className={styles.details}>
          <h2 className={enableStyles.sectionTitle}>Reconnect on</h2>
          <div className={enableStyles.infoList}>
            <div className={enableStyles.infoItem}>
              <div className={enableStyles.label}>Chain</div>
              <div className={enableStyles.infoValue}>
                <Image src={chain.logoUrl} width={14} height={14} logo />
                <span>{chain.name}</span>
              </div>
            </div>
            <div className={enableStyles.infoItem}>
              <div className={enableStyles.label}>Duration</div>
              {hasKnownDuration ? (
                <div className={enableStyles.infoValue}>{durationLabel}</div>
              ) : (
                <Dropdown
                  options={FINITE_DURATION_OPTIONS}
                  value={durationInMs}
                  onChange={setDurationInMs}
                  classNames={{
                    trigger: styles["duration-trigger"],
                    item: styles["duration-item"],
                  }}
                />
              )}
            </div>
          </div>
        </section>

        <p className={enableStyles.explanation}>
          Your wallet will ask you to approve the renewed permission scope.
        </p>
      </Scrollable>

      <Footer
        className={enableStyles.footer}
        extra={
          displayedError && (
            <FormHelp level={displayedError.startsWith("Browser storage") ? "warning" : "error"}>
              {displayedError}
            </FormHelp>
          )
        }
      >
        <Button.Outline onClick={closeDrawer} disabled={renew.isPending}>
          Not now
        </Button.Outline>
        <Button.White
          onClick={handleReconnect}
          disabled={isLoadingPreference || isLoadingIdentity}
          loading={renew.isPending}
        >
          {needsRememberedReplacement ? "Remember" : "Reconnect"}
        </Button.White>
      </Footer>
    </>
  )
}

export default ReconnectAutoSign
