import ky from "ky"
import { useState } from "react"
import { useAtom, useAtomValue } from "jotai"
import { useQuery } from "@tanstack/react-query"
import { createQueryKeys } from "@lukemorales/query-key-factory"
import { IconCheckCircle, IconExternalLink, IconWallet } from "@initia/icons-react"
import { truncate } from "@initia/utils"
import Button from "@/components/Button"
import Dropdown from "@/components/Dropdown"
import Footer from "@/components/Footer"
import FormHelp from "@/components/form/FormHelp"
import Image from "@/components/Image"
import Scrollable from "@/components/Scrollable"
import { useFindChain, useInitiaRegistry } from "@/data/chains"
import { useDrawer } from "@/data/ui"
import { useInterwovenKit } from "@/public/data/hooks"
import { useEnableAutoSign } from "./data/actions"
import { DEFAULT_DURATION, DURATION_OPTIONS } from "./data/constants"
import { pendingAutoSignRequestAtom } from "./data/store"
import styles from "./EnableAutoSign.module.css"

const accountQueries = createQueryKeys("interwovenkit:account", {
  info: (restUrl: string, address: string) => ({
    queryKey: [restUrl, address],
    queryFn: async () => {
      const rest = ky.create({ prefixUrl: restUrl })
      const path = `cosmos/auth/v1beta1/account_info/${address}`
      return rest.get(path).json()
    },
  }),
})

const EnableAutoSignComponent = () => {
  const [duration, setDuration] = useState(DEFAULT_DURATION)
  const [pendingRequest, setPendingRequest] = useAtom(pendingAutoSignRequestAtom)
  const [warningIgnored, setWarningIgnored] = useState(false)

  const findChain = useFindChain()
  const chains = useInitiaRegistry()
  const { address, username } = useInterwovenKit()
  const { mutate, isPending } = useEnableAutoSign()
  const { closeDrawer } = useDrawer()

  if (!pendingRequest) throw new Error("Pending request not found")

  const { logoUrl, name, restUrl } = findChain(pendingRequest.chainId)
  const { data: isAccountCreated, isLoading: isCheckingAccount } = useQuery(
    accountQueries.info(restUrl, address),
  )

  // Get website information
  const websiteInfo = {
    favicon: document.querySelector('link[rel="icon"]')?.getAttribute("href") || "",
    title: document.title,
    hostname: window.location.hostname,
  }

  // Check if website is verified in Initia Registry for the requested chain only
  const targetChain = chains.find((chain) => chain.chainId === pendingRequest.chainId)
  const isVerified = (() => {
    if (!targetChain?.website) return false

    try {
      return isVerifiedWebsiteHost(targetChain.website, window.location.hostname)
    } catch {
      return false
    }
  })()

  const handleEnable = () => {
    mutate(duration)
  }

  const handleCancel = () => {
    pendingRequest?.reject(new Error("User cancelled"))
    setPendingRequest(null)
    closeDrawer()
  }

  const isEnableDisabled = !isVerified && !warningIgnored

  return (
    <>
      <Scrollable className={styles.container}>
        <header>
          <h1 className={styles.title}>Enable auto-signing</h1>
          <p className={styles.description}>An application is requesting to enable auto-signing</p>
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
            <div className={styles.infoItem}>
              <div className={styles.label}>Duration</div>
              <Dropdown
                options={DURATION_OPTIONS}
                value={duration}
                onChange={setDuration}
                classNames={{ trigger: styles.durationTrigger, item: styles.durationItem }}
              />
            </div>
          </div>
        </section>

        <section>
          <h2 className={styles.sectionTitle}>About auto-signing</h2>
          <ul className={styles.featureList}>
            {[
              "Send transactions without confirmation pop-ups",
              "Secured by your wallet signature",
              "Revoke permissions any time in settings",
            ].map((item) => (
              <li key={item} className={styles.featureItem}>
                <IconCheckCircle size={12} className={styles.checkIcon} />
                <span>{item}</span>
              </li>
            ))}
          </ul>
          <a
            href="https://docs.initia.xyz/user-guides/wallet/auto-signing/introduction"
            target="_blank"
            rel="noopener noreferrer"
            className={styles.learnMoreLink}
          >
            Learn more <IconExternalLink size={12} />
          </a>
        </section>
      </Scrollable>

      <Footer
        className={styles.footer}
        extra={
          <div className={styles.feedbackContainer}>
            {!isCheckingAccount && !isAccountCreated && (
              <FormHelp level="error">Insufficient balance for fee</FormHelp>
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
        <Button.Outline onClick={handleCancel}>Cancel</Button.Outline>
        <Button.White
          onClick={handleEnable}
          disabled={isEnableDisabled || !isAccountCreated || isCheckingAccount}
          loading={isPending}
        >
          Enable
        </Button.White>
      </Footer>
    </>
  )
}

const EnableAutoSign = () => {
  const pendingRequest = useAtomValue(pendingAutoSignRequestAtom)
  if (!pendingRequest) return null
  return <EnableAutoSignComponent />
}

export default EnableAutoSign

function isVerifiedWebsiteHost(registeredWebsite: string, currentHostname: string): boolean {
  const registeredHostname = new URL(registeredWebsite).hostname.toLowerCase()
  const current = currentHostname.toLowerCase()

  if (!registeredHostname || !current) return false

  return current === registeredHostname || current.endsWith(`.${registeredHostname}`)
}
