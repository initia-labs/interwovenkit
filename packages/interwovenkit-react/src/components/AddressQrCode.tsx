import { useState } from "react"
import clsx from "clsx"
import { QRCodeSVG } from "qrcode.react"
import { IconCopy } from "@initia/icons-react"
import { useHexAddress, useInitiaAddress } from "@/public/data/hooks"
import { truncate } from "@/public/utils"
import CopyButton from "./CopyButton"
import styles from "./AddressQrCode.module.css"

enum AddressOptions {
  BECH32 = "bech32",
  HEX = "hex",
}

const AddressQrCode = () => {
  const [type, setType] = useState(AddressOptions.BECH32)
  const initiaAddress = useInitiaAddress()
  const hexAddress = useHexAddress()
  const address = type === AddressOptions.BECH32 ? initiaAddress : hexAddress

  return (
    <div className={styles.container}>
      <div className={styles.selector}>
        <button
          onClick={() => setType(AddressOptions.BECH32)}
          className={clsx({ [styles.active]: type === AddressOptions.BECH32 })}
        >
          Bech32
        </button>
        <button
          onClick={() => setType(AddressOptions.HEX)}
          className={clsx({ [styles.active]: type === AddressOptions.HEX })}
        >
          Hex
        </button>
      </div>
      <QRCodeSVG
        value={address}
        level="H"
        className={styles.qrcode}
        size={200}
        imageSettings={{
          src: "https://raw.githubusercontent.com/initia-labs/initia-registry/main/images/INIT.png",
          height: 40,
          width: 40,
          excavate: true,
        }}
      />
      <CopyButton value={address}>
        {({ copy, copied }) => (
          <button onClick={copy} className={clsx(styles.address, { [styles.copied]: copied })}>
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

export default AddressQrCode
