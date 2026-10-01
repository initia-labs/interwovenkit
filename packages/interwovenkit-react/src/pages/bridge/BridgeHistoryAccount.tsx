import { useAccount } from "wagmi"
import { IconWallet } from "@initia/icons-react"
import { InitiaAddress, truncate } from "@initia/utils"
import Image from "@/components/Image"
import styles from "./BridgeHistoryItem.module.css"

const BridgeHistoryAccount = ({ address, image }: { address: string; image?: string }) => {
  const { address: connectedAddress = "", connector } = useAccount()
  const icon =
    image ?? (InitiaAddress.equals(address, connectedAddress) ? connector?.icon : undefined)

  return (
    <div className={styles.account}>
      {icon ? <Image src={icon} width={12} height={12} /> : <IconWallet size={12} />}
      <span className="monospace">{truncate(address)}</span>
    </div>
  )
}

export default BridgeHistoryAccount
