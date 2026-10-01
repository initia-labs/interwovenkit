import ky, { HTTPError } from "ky"
import { useState } from "react"
import { useAtom, useAtomValue } from "jotai"
import { useQuery } from "@tanstack/react-query"
import { createQueryKeys } from "@lukemorales/query-key-factory"
import { IconWallet } from "@initia/icons-react"
import { truncate } from "@initia/utils"
import Button from "@/components/Button"
import Footer from "@/components/Footer"
import FormHelp from "@/components/form/FormHelp"
import Image from "@/components/Image"
import Scrollable from "@/components/Scrollable"
import { useFindChain, useInitiaRegistry } from "@/data/chains"
import { useConfig } from "@/data/config"
import { useDrawer } from "@/data/ui"
import { useInterwovenKit } from "@/public/data/hooks"
import { useEnableAutoSign } from "./data/actions"
import { DURATION_OPTIONS } from "./data/constants"
import { pendingAutoSignRequestAtom } from "./data/store"
import { useAutoSignPreference } from "./data/wallet"
import { isVerifiedWebsiteHost } from "./data/website"
import styles from "./EnableAutoSign.module.css"

function isAccountNotFoundError(error: unknown): boolean {
  return error instanceof HTTPError && error.response.status === 404
}

const accountQueries = createQueryKeys("interwovenkit:account", {
  info: (restUrl: string, address: string) => ({
    queryKey: [restUrl, address],
    queryFn: async () => {
      const rest = ky.create({ prefixUrl: restUrl })
      const path = `cosmos/auth/v1beta1/account_info/${address}`
      try {
        await rest.get(path).json()
        return true
      } catch (error) {
        if (isAccountNotFoundError(error)) {
          return false
        }
        throw error
      }
    },
  }),
})

const EnableAutoSignComponent = () => {
  const [pendingRequest, setPendingRequest] = useAtom(pendingAutoSignRequestAtom)
  const { autoSignStorage } = useConfig()
  const [warningIgnored, setWarningIgnored] = useState(false)

  const findChain = useFindChain()
  const chains = useInitiaRegistry()
  const { address, initiaAddress, username } = useInterwovenKit()
  const { mutate, isPending } = useEnableAutoSign()
  const { closeDrawer } = useDrawer()
  const { stayConnected, isLoadingPreference, isStorageUnavailable } = useAutoSignPreference(
    pendingRequest?.chainId ?? "",
    initiaAddress,
  )
  const effectiveStayConnected =
    autoSignStorage === "memory" ? false : (pendingRequest?.stayConnected ?? stayConnected)
  const preferenceError = isStorageUnavailable
    ? "Browser storage is unavailable. Restore browser storage access to enable autosign."
    : ""

  if (!pendingRequest) throw new Error("Pending request not found")

  const { logoUrl, name, restUrl } = findChain(pendingRequest.chainId)
  const {
    data: isAccountCreated,
    isLoading: isCheckingAccount,
    isError: isAccountQueryError,
  } = useQuery(accountQueries.info(restUrl, initiaAddress))

  // Get website information
  const websiteInfo = {
    favicon: document.querySelector('link[rel="icon"]')?.getAttribute("href") || "",
    title: document.title,
    hostname: window.location.hostname,
  }

  // Check if website is verified in Initia Registry for the requested chain only
  const targetChain = chains.find((chain) => chain.chainId === pendingRequest.chainId)
  const isVerified = targetChain?.website
    ? isVerifiedWebsiteHost(targetChain.website, window.location.hostname)
    : false

  const durationLabel = DURATION_OPTIONS.find(
    (option) => option.value === pendingRequest.defaultDuration,
  )?.label
  const ownerMismatch = pendingRequest.owner !== initiaAddress

  const handleEnable = () => {
    if (ownerMismatch) return
    mutate({ durationInMs: pendingRequest.defaultDuration, stayConnected: effectiveStayConnected })
  }

  const handleCancel = () => {
    if (isPending) return
    pendingRequest?.reject(new Error("User cancelled"))
    setPendingRequest(null)
    closeDrawer()
  }

  const isEnableDisabled = !isVerified && !warningIgnored
  const showInsufficientBalanceError =
    !isCheckingAccount && !isAccountQueryError && isAccountCreated === false
  const showAccountQueryError = !isCheckingAccount && isAccountQueryError
  const disableEnableButton =
    isEnableDisabled ||
    isCheckingAccount ||
    isAccountQueryError ||
    isAccountCreated === false ||
    isLoadingPreference ||
    !!preferenceError ||
    ownerMismatch

  return (
    <>
      <Scrollable className={styles.container}>
        <header>
          <h1 className={styles.title}>Enable autosign</h1>
          <p className={styles.description}>An application is requesting to enable autosign</p>
        </header>

        <section>
          <h2 className={styles.sectionTitle}>Requested by</h2>
          <div className={styles.websiteInfo}>
            <img src={websiteInfo.favicon} alt="" className={styles.favicon} />
            <div>
              <div className={styles.websiteTitle}>{websiteInfo.title}</div>
              <div className={styles.websiteHost}>{websiteInfo.hostname}</div>
            </div>
          </div>
        </section>

        <section>
          <h2 className={styles.sectionTitle}>Applies to</h2>
          <div className={styles.infoList}>
            <div className={styles.infoItem}>
              <div className={styles.label}>Address</div>
              <div className={styles.infoValue}>
                <IconWallet size={14} />
                <span className="monospace">{truncate(username ?? address)}</span>
              </div>
            </div>
            <div className={styles.infoItem}>
              <div className={styles.label}>Chain</div>
              <div className={styles.infoValue}>
                <Image src={logoUrl} width={14} height={14} logo />
                <span>{name}</span>
              </div>
            </div>
            {durationLabel && (
              <div className={styles.infoItem}>
                <div className={styles.label}>Duration</div>
                <div className={styles.infoValue}>{durationLabel}</div>
              </div>
            )}
          </div>
        </section>
      </Scrollable>

      <Footer
        className={styles.footer}
        extra={
          <div className={styles.feedbackContainer}>
            {showInsufficientBalanceError && (
              <FormHelp level="error">Insufficient balance for fee</FormHelp>
            )}
            {showAccountQueryError && (
              <FormHelp level="warning">Unable to verify account status. Try again.</FormHelp>
            )}
            {preferenceError && <FormHelp level="warning">{preferenceError}</FormHelp>}
            {ownerMismatch && (
              <FormHelp level="error">The connected wallet changed. Close and try again.</FormHelp>
            )}

            {!isVerified && !warningIgnored && (
              <FormHelp level="warning">
                <div className={styles.warningContent}>
                  <span>You are on an unverified website</span>
                  <button onClick={() => setWarningIgnored(true)} className={styles.ignoreButton}>
                    Ignore
                  </button>
                </div>
              </FormHelp>
            )}
          </div>
        }
      >
        <Button.Outline onClick={handleCancel} disabled={isPending}>
          Cancel
        </Button.Outline>
        <Button.White onClick={handleEnable} disabled={disableEnableButton} loading={isPending}>
          Enable
        </Button.White>
      </Footer>
    </>
  )
}

const EnableAutoSign = () => {
  const pendingRequest = useAtomValue(pendingAutoSignRequestAtom)
  if (!pendingRequest) return null
  return (
    <EnableAutoSignComponent
      key={`${pendingRequest.owner}:${pendingRequest.chainId}:${pendingRequest.defaultDuration}`}
    />
  )
}

export default EnableAutoSign
