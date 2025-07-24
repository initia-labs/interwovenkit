import { useState } from "react"
import { useInterwovenKit } from "../data/hooks"
import AddressQr from "./AddressQr"
import styles from "./AddressQrList.module.css"

const AddressQrList = () => {
  // NOTE: We're not using radix-ui Tabs here due to a side effect in the built version
  // where the initial value would change unexpectedly. This custom implementation
  // provides full control over the tab behavior without external dependencies.
  const [activeTab, setActiveTab] = useState("bech32")
  const { initiaAddress, hexAddress } = useInterwovenKit()

  return (
    <div className={styles.root}>
      <div className={styles.list}>
        <button
          className={styles.trigger}
          onClick={() => setActiveTab("bech32")}
          data-state={activeTab === "bech32" ? "active" : undefined}
        >
          init
        </button>
        <button
          className={styles.trigger}
          onClick={() => setActiveTab("hex")}
          data-state={activeTab === "hex" ? "active" : undefined}
        >
          0x
        </button>
      </div>
      {activeTab === "bech32" && <AddressQr address={initiaAddress} />}
      {activeTab === "hex" && <AddressQr address={hexAddress} />}
    </div>
  )
}

export default AddressQrList
