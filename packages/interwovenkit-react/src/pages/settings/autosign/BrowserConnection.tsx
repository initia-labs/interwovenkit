import { useEffect, useRef, useState } from "react"
import Button from "@/components/Button"
import FormHelp from "@/components/form/FormHelp"
import { useConfig } from "@/data/config"
import { useNavigate } from "@/lib/router"
import { subscribeAutoSignEvents } from "@/pages/autosign/data/lifecycle"
import { useAutoSign } from "@/pages/autosign/data/public"
import { useAutoSignStatus } from "@/pages/autosign/data/validation"
import { getExpectedAddress, useDeriveWallet } from "@/pages/autosign/data/wallet"
import StayConnected from "@/pages/autosign/StayConnected"
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
  const [identityProvenance, setIdentityProvenance] = useState<
    "legacy-derived" | "random" | undefined
  >()
  const [identityDuration, setIdentityDuration] = useState<number>()
  const [reload, setReload] = useState(0)

  useEffect(() => {
    walletRef.current = wallet
    statusQueryRef.current = statusQuery
  }, [statusQuery, wallet])

  useEffect(() => {
    setMessage("")
    setIsConfirmingForget(false)
    setHasWallet(!!walletRef.current.getWallet(defaultChainId))
    setIdentityProvenance(undefined)
    setIdentityDuration(undefined)

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
      walletRef.current.getActiveIdentity(defaultChainId),
    ])
      .then(([restored, preference, identity]) => {
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
        if (identity.status === "fulfilled") {
          setIdentityProvenance(identity.value?.provenance)
          setIdentityDuration(identity.value?.requestedDurationMs)
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

  const handleChange = async (checked: boolean) => {
    setIsSaving(true)
    setMessage("")
    try {
      await walletRef.current.setStayConnected(defaultChainId, checked)
      setStayConnectedState(checked)
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to update this setting.")
    } finally {
      setIsSaving(false)
    }
  }

  const handleForget = async () => {
    setIsSaving(true)
    setMessage("")
    try {
      await walletRef.current.forgetWallet(defaultChainId)
      setStayConnectedState(false)
      setHasWallet(false)
      setIdentityProvenance(undefined)
      setIdentityDuration(undefined)
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
      await autoSign.enable(defaultChainId, { defaultDuration: identityDuration })
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to enable auto-signing again.")
      setIsEnablingAgain(false)
    }
  }

  const canUnlockLegacy =
    !hasWallet &&
    chainStatus === "enabled" &&
    (identityProvenance === "legacy-derived" ||
      (!identityProvenance && !!expectedGrantee && expectedGrantee === statusGrantee))
  const randomKeyMissing =
    !hasWallet && identityProvenance === "random" && chainStatus !== "unknown"
  const canReplaceRandom = randomKeyMissing && identityDuration !== undefined
  const hasSavedKey = hasWallet || !!identityProvenance
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
              : "No usable auto-signing key was found on this browser."

  return (
    <section className={styles.container}>
      <h2>On this browser</h2>
      {autoSignStorage === "memory" ? (
        <p className={styles.note}>Auto-signing is available only until this tab reloads.</p>
      ) : (
        <StayConnected
          checked={stayConnected}
          disabled={isLoading || isSaving || !hasWallet}
          onChange={handleChange}
        />
      )}

      <div className={styles.mode}>
        <span>Connection</span>
        <span>{connectionLabel}</span>
      </div>
      <p className={styles.note}>{note}</p>

      {canUnlockLegacy && (
        <Button.Small onClick={() => navigate("/autosign/unlock", { chainId: defaultChainId })}>
          Unlock
        </Button.Small>
      )}
      {randomKeyMissing && (
        <>
          <p className={styles.note}>
            {canReplaceRandom
              ? "This key cannot be recovered. Enabling again will replace its permissions with a new auto-signing address."
              : "This key cannot be recovered. Revoke its permissions before enabling again."}
          </p>
          {canReplaceRandom && (
            <Button.Small onClick={handleEnableAgain} disabled={isEnablingAgain}>
              {isEnablingAgain ? "Opening..." : "Enable again"}
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
