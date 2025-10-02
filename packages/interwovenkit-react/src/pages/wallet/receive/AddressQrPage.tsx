import clsx from "clsx"
import QRCodeStyling from "qr-code-styling"
import { useEffect, useRef } from "react"
import { IconCopy } from "@initia/icons-react"
import { truncate } from "@initia/utils"
import Page from "@/components/Page"
import CopyButton from "@/components/CopyButton"
import styles from "./AddressQrPage.module.css"
import { usePortalCssVariable } from "@/public/app/PortalContext"
import { useInterwovenKit } from "@/public/data/hooks"

const AddressQrPage = () => {
  const ref = useRef<HTMLDivElement>(null)
  const qrCode = useRef<QRCodeStyling | null>(null)

  const { initiaAddress, hexAddress } = useInterwovenKit()
  const color = usePortalCssVariable("--gray-0")

  useEffect(() => {
    if (!ref.current) return

    if (!qrCode.current) {
      qrCode.current = new QRCodeStyling({
        type: "canvas",
        width: 400,
        height: 400,
        margin: 0,
        data: initiaAddress,
        image: "https://registry.initia.xyz/images/INIT.png",
        qrOptions: { mode: "Byte", errorCorrectionLevel: "H" },
        imageOptions: { crossOrigin: "anonymous", margin: 12 },
        dotsOptions: { type: "dots", color },
        cornersSquareOptions: { type: "extra-rounded", color },
        cornersDotOptions: { type: "dot", color },
        backgroundOptions: { color: "transparent" },
      })

      qrCode.current.append(ref.current)
    } else {
      qrCode.current.update({
        data: initiaAddress,
      })
    }
  }, [initiaAddress, color])

  return (
    <Page title="Receive">
      <div className={styles.root}>
        <div ref={ref} style={{ width: 200, height: 200 }} />

        <span className={styles.address}>{initiaAddress}</span>

        <CopyButton value={initiaAddress}>
          {({ copy, copied }) => (
            <button className={clsx(styles.copy, { [styles.copied]: copied })} onClick={copy}>
              <IconCopy size={12} />
              <div className={styles.labelWrapper}>
                <span className={styles.labelCopy}>Copy address</span>
                <span className={styles.labelCopied}>Copied!</span>
              </div>
            </button>
          )}
        </CopyButton>

        <CopyButton value={hexAddress}>
          {({ copy, copied }) => (
            <button className={clsx(styles.derived, { [styles.copied]: copied })} onClick={copy}>
              <span className={styles.derivedLabel}>Derived from</span>
              <span className={styles.derivedAddress}>
                <span className={styles.hexAddress}>{truncate(hexAddress)}</span>
                <IconCopy size={12} className={styles.derivedCopy} />
                {copied && <span className={styles.copiedText}>Copied!</span>}
              </span>
            </button>
          )}
        </CopyButton>
      </div>
    </Page>
  )
}

export default AddressQrPage
