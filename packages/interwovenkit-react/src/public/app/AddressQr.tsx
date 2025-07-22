import clsx from "clsx"
import { QRCodeSVG } from "qrcode.react"
import { IconCopy } from "@initia/icons-react"
import CopyButton from "@/components/CopyButton"
import { truncate } from "../utils"
import styles from "./AddressQr.module.css"

const AddressQr = ({ address }: { address: string }) => {
  return (
    <div className={styles.root}>
      <QRCodeSVG
        value={address}
        className={styles.qr}
        size={200}
        imageSettings={{
          src: "https://registry.initia.xyz/images/INIT.png",
          height: 36,
          width: 36,
          excavate: true,
        }}
      />

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
