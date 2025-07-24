import clsx from "clsx"
import QRCodeStyling from "qr-code-styling"
import { useEffect, useRef } from "react"
import { IconCopy } from "@initia/icons-react"
import CopyButton from "@/components/CopyButton"
import { truncate } from "../utils"
import styles from "./AddressQr.module.css"

const AddressQr = ({ address }: { address: string }) => {
  const ref = useRef<HTMLDivElement>(null)
  const qrCode = useRef<QRCodeStyling | null>(null)

  useEffect(() => {
    if (!ref.current) return

    const computedStyle = getComputedStyle(ref.current)
    const color = computedStyle.getPropertyValue("--gray-0")

    if (!qrCode.current) {
      qrCode.current = new QRCodeStyling({
        type: "canvas",
        width: 360,
        height: 360,
        margin: 0,
        data: address,
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
        data: address,
      })
    }
  }, [address])

  return (
    <div className={styles.root}>
      <div ref={ref} style={{ width: 180, height: 180 }} />

      <CopyButton value={address}>
        {({ copy, copied }) => (
          <button className={clsx(styles.address, { [styles.copied]: copied })} onClick={copy}>
            <span className="monospace">{truncate(address)}</span>
            <span className={styles.icon}>
              <IconCopy size={16} />
              {copied ? "Copied!" : ""}
            </span>
          </button>
        )}
      </CopyButton>
    </div>
  )
}

export default AddressQr
