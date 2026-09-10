import { useEffect, useRef, useState } from "react"
import { useAtomValue } from "jotai"
import { IconWallet } from "@initia/icons-react"
import { truncate } from "@initia/utils"
import Button from "@/components/Button"
import Footer from "@/components/Footer"
import FormHelp from "@/components/form/FormHelp"
import Image from "@/components/Image"
import Scrollable from "@/components/Scrollable"
import { useFindChain } from "@/data/chains"
import { useConfig } from "@/data/config"
import { useLocationState, useNavigate } from "@/lib/router"
import { useInterwovenKit } from "@/public/data/hooks"
import { AutoSignCancelledError } from "./data/lifecycle"
import type { AutoSignPublicIdentity } from "./data/storage"
import { pendingAutoSignUnlockAtom } from "./data/unlock-request"
import { useAutoSignStatus } from "./data/validation"
import { getExpectedAddress, useAutoSignPreference, useDeriveWallet } from "./data/wallet"
import enableStyles from "./EnableAutoSign.module.css"

const UnlockAutoSign = () => {
  const pendingUnlock = useAtomValue(pendingAutoSignUnlockAtom)
  const { chainId: requestedChainId } = useLocationState<{ chainId?: string }>()
  const { autoSignStorage, defaultChainId } = useConfig()
  const chainId = pendingUnlock?.chainId ?? requestedChainId ?? defaultChainId
  const chain = useFindChain()(chainId)
  const { address, initiaAddress, username } = useInterwovenKit()
  const navigate = useNavigate()
  const wallet = useDeriveWallet()
  const walletRef = useRef(wallet)

  useEffect(() => {
    walletRef.current = wallet
  }, [wallet])
  const autoSignStatus = useAutoSignStatus()
  const chainStatus = autoSignStatus.data?.statusByChain[chainId]
  const statusGrantee = autoSignStatus.data?.granteeByChain[chainId]
  const [activeIdentity, setActiveIdentity] = useState<AutoSignPublicIdentity>()
  const [isLoadingIdentity, setIsLoadingIdentity] = useState(true)
  const expectedLegacyGrantee = initiaAddress
    ? getExpectedAddress(initiaAddress, chainId)
    : undefined
  const matchesActiveLegacyIdentity =
    activeIdentity?.owner === initiaAddress &&
    activeIdentity.chainId === chainId &&
    activeIdentity.state === "active" &&
    activeIdentity.provenance === "legacy-derived" &&
    activeIdentity.address === statusGrantee
  const matchesLegacyMirror =
    !isLoadingIdentity &&
    !activeIdentity &&
    !!expectedLegacyGrantee &&
    expectedLegacyGrantee === statusGrantee
  const canUnlock =
    chainStatus === "enabled" &&
    (matchesActiveLegacyIdentity || matchesLegacyMirror) &&
    (!pendingUnlock || pendingUnlock.owner === initiaAddress)

  const { stayConnected, isLoadingPreference, isStorageUnavailable } = useAutoSignPreference(
    chainId,
    initiaAddress,
  )
  const [isPending, setIsPending] = useState(false)
  const [error, setError] = useState("")
  const displayedError =
    error ||
    (isStorageUnavailable
      ? "Browser storage is unavailable. Restore browser storage access to continue autosign."
      : "")
  const isInitialLegacyMigration =
    canUnlock && matchesLegacyMirror && autoSignStorage !== "memory" && stayConnected
  const recoveryDescription =
    autoSignStorage === "memory"
      ? "Confirm with your wallet to continue autosign until this tab reloads. Your existing permissions won’t change."
      : stayConnected
        ? "Confirm with your wallet to continue autosign on this browser. Your existing permissions won’t change."
        : "Confirm with your wallet to continue autosign in this tab. Your existing permissions won’t change."

  useEffect(() => {
    let active = true
    setIsLoadingIdentity(true)
    walletRef.current
      .getActiveIdentity(chainId)
      .then((identity) => {
        if (active) setActiveIdentity(identity)
      })
      .catch(() => {
        if (active) setActiveIdentity(undefined)
      })
      .finally(() => {
        if (active) setIsLoadingIdentity(false)
      })
    return () => {
      active = false
    }
  }, [chainId, initiaAddress, pendingUnlock?.owner])

  const handleUnlock = async () => {
    if (!canUnlock) return
    setIsPending(true)
    setError("")
    try {
      const derivedWallet = await walletRef.current.deriveWallet(chainId, { stayConnected })
      if (pendingUnlock) {
        pendingUnlock.resolve(derivedWallet)
      } else {
        navigate(-1)
      }
    } catch (unlockError) {
      setError(unlockError instanceof Error ? unlockError.message : "Unable to continue autosign.")
    } finally {
      setIsPending(false)
    }
  }

  const handleCancel = () => {
    if (pendingUnlock) {
      pendingUnlock.reject(new AutoSignCancelledError("User rejected auto-signing unlock"))
    } else {
      navigate(-1)
    }
  }

  return (
    <>
      <Scrollable className={enableStyles.container}>
        <header>
          <h1 className={enableStyles.title}>
            {isInitialLegacyMigration ? "Upgrade autosign" : "Continue autosign"}
          </h1>
          <p className={enableStyles.description}>
            {isInitialLegacyMigration
              ? "Autosign can now stay available across browser restarts. Confirm once with your wallet to remember it on this browser. Your existing permissions won’t change."
              : canUnlock
                ? recoveryDescription
                : `Check your autosign permissions on ${chain.name}.`}
          </p>
        </header>

        <section>
          <h2 className={enableStyles.sectionTitle}>Applies to</h2>
          <div className={enableStyles.infoList}>
            <div className={enableStyles.infoItem}>
              <div className={enableStyles.label}>Address</div>
              <div className={enableStyles.infoValue}>
                <IconWallet size={14} />
                <span className="monospace">{truncate(username ?? address)}</span>
              </div>
            </div>
            <div className={enableStyles.infoItem}>
              <div className={enableStyles.label}>Chain</div>
              <div className={enableStyles.infoValue}>
                <Image src={chain.logoUrl} width={14} height={14} logo />
                <span>{chain.name}</span>
              </div>
            </div>
          </div>
        </section>

        {!canUnlock && (
          <FormHelp
            level={
              chainStatus === "unknown" || activeIdentity?.provenance === "random"
                ? "warning"
                : "info"
            }
          >
            {activeIdentity?.provenance === "random"
              ? "This browser key cannot be recovered. Cancel this transaction, then choose Remember on this browser in Settings."
              : chainStatus === "unknown"
                ? "Unable to check permissions. Try again before continuing."
                : chainStatus === "expired"
                  ? "These permissions expired. Reconnect them from autosign settings."
                  : chainStatus === "enabled" && !isLoadingIdentity
                    ? "The active autosign identity cannot be safely recovered on this browser."
                    : "No active permissions were found for this autosign address."}
          </FormHelp>
        )}
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
        <Button.Outline onClick={handleCancel} disabled={isPending}>
          Cancel
        </Button.Outline>
        <Button.White
          onClick={handleUnlock}
          disabled={
            isLoadingPreference || isLoadingIdentity || autoSignStatus.isPending || !canUnlock
          }
          loading={isPending}
        >
          {isInitialLegacyMigration ? "Confirm" : "Continue"}
        </Button.White>
      </Footer>
    </>
  )
}

export default UnlockAutoSign
