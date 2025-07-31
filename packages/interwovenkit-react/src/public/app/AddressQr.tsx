import clsx from "clsx"
import QRCodeStyling from "qr-code-styling"
import { useEffect, useRef } from "react"
import { IconCopy } from "@initia/icons-react"
import { truncate } from "@initia/utils"
import WidgetTooltip from "@/components/WidgetTooltip"
import CopyButton from "@/components/CopyButton"
import { useInterwovenKit } from "../data/hooks"
import styles from "./AddressQr.module.css"

const AddressQr = () => {
  const ref = useRef<HTMLDivElement>(null)
  const qrCode = useRef<QRCodeStyling | null>(null)

  const { initiaAddress, hexAddress } = useInterwovenKit()

  useEffect(() => {
    if (!ref.current) return

    const computedStyle = getComputedStyle(ref.current)
    const color = computedStyle.getPropertyValue("--gray-0")

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

      // Workaround for mobile
      // This helps ensure the center image renders properly on mobile devices
      setTimeout(() => {
        qrCode.current?.update()
      })
    } else {
      qrCode.current.update({
        data: initiaAddress,
      })
    }
  }, [initiaAddress])

  return (
    <div className={styles.root}>
      <div ref={ref} style={{ width: 200, height: 200 }} />

      <WidgetTooltip label={`Derived from ${truncate(hexAddress)}`}>
        <span className={styles.address}>{initiaAddress}</span>
      </WidgetTooltip>

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
    </div>
  )
}

export default AddressQr
