import { useEffect, useRef, useState } from "react"
import Button from "@/components/Button"
import FormHelp from "@/components/form/FormHelp"
import { useConfig } from "@/data/config"
import { useNavigate } from "@/lib/router"
import { subscribeAutoSignEvents } from "@/pages/autosign/data/lifecycle"
import { useAutoSign } from "@/pages/autosign/data/public"
import type { AutoSignPublicIdentity } from "@/pages/autosign/data/storage"
import { useAutoSignStatus } from "@/pages/autosign/data/validation"
import {
  getExpectedAddress,
  useDeriveWallet,
} from "@/pages/autosign/data/wallet"
import { useInitiaAddress } from "@/public/data/hooks"
import styles from "./BrowserConnection.module.css"

const BrowserConnection = () => {
  const { autoSignStorage, defaultChainId } = useConfig()
  const owner = useInitiaAddress()
  const navigate = useNavigate()
  const wallet = useDeriveWallet()
  const walletRef = useRef(wallet)
  const statusQuery = useAutoSignStatus()
  const statusQueryRef = useRef(statusQuery)
  const autoSign = useAutoSign()
  const chainStatus = statusQuery.data?.statusByChain[defaultChainId]
  const statusGrantee = statusQuery.data?.granteeByChain[defaultChainId]
  const expectedGrantee = owner ? getExpectedAddress(owner, defaultChainId) : undefined

  const [stayConnected, setStayConnectedState] = useState(true)
  const [isLoading, setIsLoading] = useState(autoSignStorage !== "memory")
  const [isSaving, setIsSaving] = useState(false)
  const [isEnablingAgain, setIsEnablingAgain] = useState(false)
  const [isConfirmingForget, setIsConfirmingForget] = useState(false)
  const [message, setMessage] = useState("")
  const [hasWallet, setHasWallet] = useState(false)
  const [recoveryIdentity, setRecoveryIdentity] = useState<AutoSignPublicIdentity>()
  const [reload, setReload] = useState(0)

  useEffect(() => {
    walletRef.current = wallet
    statusQueryRef.current = statusQuery
  }, [statusQuery, wallet])

  useEffect(() => {
    setMessage("")
    setIsConfirmingForget(false)
    setHasWallet(!!walletRef.current.getWallet(defaultChainId))
    setRecoveryIdentity(undefined)

    if (autoSignStorage === "memory") {
      setStayConnectedState(false)
      setIsLoading(false)
      return
    }

    let active = true
    setIsLoading(true)
    Promise.allSettled([
      walletRef.current.restoreWallet(defaultChainId),
      walletRef.current.getStayConnected(defaultChainId),
      walletRef.current.getWalletIdentities(defaultChainId),
    ])
      .then(([restored, preference, identities]) => {
        if (!active) return
        setHasWallet(
          restored.status === "fulfilled" &&
            (!!restored.value || !!walletRef.current.getWallet(defaultChainId)),
        )
        if (preference.status === "fulfilled") {
          setStayConnectedState(preference.value)
        } else {
          setMessage("Unable to load the browser connection setting.")
        }
        if (identities.status === "fulfilled") {
          const matchingIdentities = identities.value.filter(
            (identity) => identity.owner === owner && identity.chainId === defaultChainId,
          )
          const identity =
            matchingIdentities.find((candidate) => candidate.state === "active") ??
            matchingIdentities.find((candidate) => candidate.provenance === "random")
          setRecoveryIdentity(identity)
        }
      })
      .finally(() => {
        if (active) setIsLoading(false)
      })
    return () => {
      active = false
    }
  }, [autoSignStorage, defaultChainId, owner, reload])

  useEffect(() => {
    if (!owner) return
    return subscribeAutoSignEvents((event) => {
      if (
        event.owner === owner &&
        ["storage-mode", "wallet-active", "wallet-paused"].includes(event.topic)
      ) {
        setReload((value) => value + 1)
        void statusQueryRef.current.refetch()
      }
    })
  }, [owner])

  const handleForget = async () => {
    setIsSaving(true)
    setMessage("")
    try {
      await walletRef.current.forgetWallet(defaultChainId)
      setStayConnectedState(false)
      setHasWallet(false)
      setRecoveryIdentity((identity) =>
        identity ? { ...identity, state: "forgotten" } : undefined,
      )
      setIsConfirmingForget(false)
      setMessage("Saved key removed. On-chain permissions remain active.")
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to forget this browser.")
    } finally {
      setIsSaving(false)
    }
  }

  const handleRetry = async () => {
    setMessage("")
    await statusQuery.refetch()
    setReload((value) => value + 1)
  }

  const handleEnableAgain = async () => {
    setIsEnablingAgain(true)
    setMessage("")
    try {
      await autoSign.enable(defaultChainId, {
        defaultDuration: recoveryIdentity?.requestedDurationMs,
        stayConnected: true,
      })
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to remember autosign.")
      setIsEnablingAgain(false)
    }
  }

  const canUnlockLegacy =
    !hasWallet &&
    chainStatus === "enabled" &&
    (recoveryIdentity?.provenance === "legacy-derived" ||
      (!recoveryIdentity && !!expectedGrantee && expectedGrantee === statusGrantee))
  const randomKeyMissing =
    !hasWallet && recoveryIdentity?.provenance === "random" && chainStatus !== "unknown"
  const canReplaceRandom = randomKeyMissing && recoveryIdentity.requestedDurationMs !== undefined
  const hasSavedKey = hasWallet || recoveryIdentity?.state === "active"
  const connectionLabel = isLoading
    ? "Checking..."
    : chainStatus === "unknown"
      ? "Unable to check"
      : chainStatus === "expired"
        ? "Expired"
        : chainStatus === "needs-permission-update"
          ? "Permission update required"
          : hasWallet
            ? stayConnected
              ? "Remembered on this browser"
              : "This tab only"
            : chainStatus === "enabled"
              ? "Key unavailable"
              : "Not enabled"

  const note =
    chainStatus === "unknown"
      ? "Unable to verify current permissions. Your saved key has been kept."
      : chainStatus === "expired"
        ? "The saved permissions expired. Reconnect them from the permission card below."
        : chainStatus === "needs-permission-update"
          ? "The configured permission scope changed and needs approval in your main wallet."
          : hasWallet
            ? stayConnected
              ? "Saved on this browser. Permissions and address are unchanged."
              : "Available in this tab, including reloads. Permissions remain active after it closes."
            : chainStatus === "enabled"
              ? "Permissions are active, but this browser does not have a usable key."
              : "No usable autosign key was found on this browser."

  return (
    <section className={styles.container}>
      <h2>On this browser</h2>
      {autoSignStorage === "memory" ? (
        <p className={styles.note}>Autosign is available only until this tab reloads.</p>
      ) : null}

      <div className={styles.mode}>
        <span>Connection</span>
        <span>{connectionLabel}</span>
      </div>
      <p className={styles.note}>{note}</p>

      {canUnlockLegacy && (
        <Button.Small onClick={() => navigate("/autosign/unlock", { chainId: defaultChainId })}>
          Continue autosign
        </Button.Small>
      )}
      {randomKeyMissing && (
        <>
          <p className={styles.note}>
            {canReplaceRandom
              ? "This key cannot be recovered. Remembering this browser will replace its permissions with a new autosign address."
              : "This key cannot be recovered. Revoke its permissions before enabling again."}
          </p>
          {canReplaceRandom && (
            <Button.Small onClick={handleEnableAgain} disabled={isEnablingAgain}>
              {isEnablingAgain ? "Opening..." : "Remember on this browser"}
            </Button.Small>
          )}
        </>
      )}
      {!isLoading && chainStatus === "unknown" && (
        <Button.Small onClick={handleRetry} disabled={statusQuery.isFetching}>
          {statusQuery.isFetching ? "Checking..." : "Try again"}
        </Button.Small>
      )}
      {message && (
        <FormHelp level={message.startsWith("Saved key removed") ? "info" : "error"}>
          {message}
        </FormHelp>
      )}

      {autoSignStorage !== "memory" &&
        hasSavedKey &&
        (isConfirmingForget ? (
          <div className={styles.confirmation}>
            <p>Remove this browser&apos;s saved key? On-chain permissions will remain active.</p>
            <div className={styles.actions}>
              <Button.Small onClick={() => setIsConfirmingForget(false)} disabled={isSaving}>
                Cancel
              </Button.Small>
              <Button.Small onClick={handleForget} disabled={isSaving}>
                {isSaving ? "Forgetting..." : "Forget browser"}
              </Button.Small>
            </div>
          </div>
        ) : (
          <button className={styles.forgetButton} onClick={() => setIsConfirmingForget(true)}>
            Forget this browser
          </button>
        ))}
    </section>
  )
}

export default BrowserConnection
