import { useState } from "react"
import { useAtom } from "jotai"
import { IconCheckCircle, IconWallet } from "@initia/icons-react"
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

export default function EnableAutoSign() {
  const [duration, setDuration] = useState(DEFAULT_DURATION)
  const [pendingRequest, setPendingRequest] = useAtom(pendingAutoSignRequestAtom)
  const [warningIgnored, setWarningIgnored] = useState(false)

  const findChain = useFindChain()
  const chains = useInitiaRegistry()
  const { address, username } = useInterwovenKit()
  const { mutate, isPending } = useEnableAutoSign()
  const { closeDrawer } = useDrawer()

  // Get website information
  const websiteInfo = {
    favicon: document.querySelector('link[rel="icon"]')?.getAttribute("href") || "",
    title: document.title,
    hostname: window.location.hostname,
  }

  // Check if website is verified in Initia Registry
  const isVerified = chains.some((chain) => {
    if (!chain.website) return false
    const registryDomain = getBaseDomain(new URL(chain.website).hostname)
    const websiteDomain = getBaseDomain(window.location.hostname)
    return registryDomain === websiteDomain
  })

  if (!pendingRequest) return null

  const { logoUrl, name } = findChain(pendingRequest.chainId)

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

          {!isVerified && !warningIgnored && (
            <FormHelp level="warning" mt={8}>
              <div className={styles.warningContent}>
                <span>You are on an unverified website</span>
                <button onClick={() => setWarningIgnored(true)} className={styles.ignoreButton}>
                  Ignore
                </button>
              </div>
            </FormHelp>
          )}
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
              "Protected by Privy embedded wallet",
              "Revoke permissions any time in settings",
            ].map((item) => (
              <li key={item} className={styles.featureItem}>
                <IconCheckCircle size={12} className={styles.checkIcon} />
                <span>{item}</span>
              </li>
            ))}
          </ul>
        </section>
      </Scrollable>

      <Footer className={styles.footer}>
        <Button.Outline onClick={handleCancel}>Cancel</Button.Outline>
        <Button.White onClick={handleEnable} disabled={isEnableDisabled || isPending}>
          {isPending ? "Loading" : "Enable"}
        </Button.White>
      </Footer>
    </>
  )
}

/**
 * Extract base domain from hostname (e.g., subdomain.example.com -> example.com)
 */
function getBaseDomain(hostname: string): string {
  const parts = hostname.split(".")
  if (parts.length < 2) return hostname
  return parts.slice(-2).join(".")
}
