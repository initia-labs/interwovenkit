import { Tabs } from "radix-ui"
import { useInterwovenKit } from "../data/hooks"
import AddressQr from "./AddressQr"
import styles from "./AddressQrList.module.css"

const AddressQrList = () => {
  const { initiaAddress, hexAddress } = useInterwovenKit()

  return (
    <Tabs.Root className={styles.root} defaultValue="bech32">
      <Tabs.List className={styles.list}>
        <Tabs.Trigger value="bech32" className={styles.trigger}>
          Bech32
        </Tabs.Trigger>
        <Tabs.Trigger value="hex" className={styles.trigger}>
          Hex
        </Tabs.Trigger>
      </Tabs.List>
      <Tabs.Content value="bech32">
        <AddressQr address={initiaAddress} />
      </Tabs.Content>
      <Tabs.Content value="hex">
        <AddressQr address={hexAddress} />
      </Tabs.Content>
    </Tabs.Root>
  )
}

export default AddressQrList
